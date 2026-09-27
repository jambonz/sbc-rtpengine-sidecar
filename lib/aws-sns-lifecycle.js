const Emitter = require('events');
const bent = require('bent');
const assert = require('assert');
const {AWS_REGION} = require('./config');
const {LifeCycleEvents} = require('./constants');
/* EC2 instance metadata, IMDSv2 only: fetch a session token with PUT, then
 * present it on the GET. The token-less GET form is IMDSv1, which the launch
 * templates disable (HttpTokens=required) so a customer-supplied webhook aimed
 * at 169.254.169.254 cannot reach the instance role's credentials. */
const IMDS = 'http://169.254.169.254/latest';
const getImdsToken = bent('PUT', 'string', {'X-aws-ec2-metadata-token-ttl-seconds': '60'});
const imds = async(path) => {
  const token = await getImdsToken(`${IMDS}/api/token`);
  return bent('string', {'X-aws-ec2-metadata-token': token})(`${IMDS}/meta-data/${path}`);
};
const {
  AutoScalingClient,
  DescribeAutoScalingInstancesCommand,
  DescribeLifecycleHooksCommand,
  CompleteLifecycleActionCommand } = require('@aws-sdk/client-auto-scaling');
const autoScalingClient = new AutoScalingClient({ region: AWS_REGION, apiVersion: '2011-01-01' });

/* how often to poll IMDS for autoscaling/target-lifecycle-state */
const POLL_INTERVAL = 20000;
const TERMINATING = 'autoscaling:EC2_INSTANCE_TERMINATING';

class LifecycleNotifier extends Emitter {
  constructor(logger) {
    super();

    this.logger = logger;
  }

  /* discover our instance id, autoscaling group and terminating lifecycle hook;
     resolves true if the drain can be supported, false otherwise (never throws) */
  async init() {
    try {
      this.instanceId = await imds('instance-id');
      const data = await this.describeInstance();
      const instance = data.AutoScalingInstances && data.AutoScalingInstances[0];
      if (!instance) throw new Error(`instance ${this.instanceId} is not in an autoscaling group`);
      this.asgName = instance.AutoScalingGroupName;
      this.lifecycleState = instance.LifecycleState;

      const {LifecycleHooks = []} = await autoScalingClient.send(new DescribeLifecycleHooksCommand({
        AutoScalingGroupName: this.asgName
      }));
      const hook = LifecycleHooks.find((h) => h.LifecycleTransition === TERMINATING);
      if (!hook) throw new Error(`autoscaling group ${this.asgName} has no ${TERMINATING} lifecycle hook`);
      this.hookName = hook.LifecycleHookName;

      this.logger.info({instanceId: this.instanceId, asgName: this.asgName, hookName: this.hookName},
        `LifecycleNotifier: scale-in drain enabled for autoscaling group ${this.asgName}, hook ${this.hookName}`);
      return true;
    } catch (err) {
      this.logger.error({err}, 'LifecycleNotifier: failed to discover autoscaling lifecycle hook, drain disabled');
      return false;
    }
  }

  /* poll IMDS until the autoscaling group moves us to Terminating:Wait */
  startPolling() {
    this.timer = setInterval(async() => {
      try {
        const state = (await imds('autoscaling/target-lifecycle-state')).trim();
        if ('Terminated' !== state || this.operationalState === LifeCycleEvents.ScaleIn) return;
        clearInterval(this.timer);
        this.logger.info('LifecycleNotifier - begin scale-in operation');
        this.operationalState = LifeCycleEvents.ScaleIn;
        this.emit(LifeCycleEvents.ScaleIn);
      } catch (err) {
        this.logger.warn({err}, 'LifecycleNotifier: error reading target-lifecycle-state from IMDS');
      }
    }, POLL_INTERVAL);
    this.timer.unref();
  }

  completeScaleIn() {
    assert(this.asgName && this.hookName);
    autoScalingClient.send(new CompleteLifecycleActionCommand({
      AutoScalingGroupName: this.asgName,
      LifecycleHookName: this.hookName,
      InstanceId: this.instanceId,
      LifecycleActionResult: 'CONTINUE'
    }))
      .then((data) => {
        return this.logger.info({data}, 'Successfully completed scale-in action');
      })
      .catch((err) => {
        this.logger.error({err}, 'Error completing scale-in');
      });
  }

  describeInstance() {
    return new Promise((resolve, reject) => {
      if (!this.instanceId) return reject('instance-id unknown');
      autoScalingClient.send(new DescribeAutoScalingInstancesCommand({
        InstanceIds: [this.instanceId]
      }))
        .then((data) => {
          this.logger.debug({data}, 'LifecycleNotifier: describeInstance');
          return resolve(data);
        })
        .catch((err) => {
          this.logger.error({err}, 'Error describing instances');
          reject(err);
        });
    });
  }

}

module.exports = async function(logger) {
  const notifier = new LifecycleNotifier(logger);
  if (!await notifier.init()) return notifier;
  notifier.startPolling();

  process.on('SIGHUP', async() => {
    try {
      const data = await notifier.describeInstance();
      const state = data.AutoScalingInstances[0].LifecycleState;
      if (state !== notifier.lifecycleState) {
        notifier.lifecycleState = state;
        switch (state) {
          case 'Standby':
            notifier.emit(LifeCycleEvents.StandbyEnter);
            break;
          case 'InService':
            notifier.emit(LifeCycleEvents.StandbyExit);
            break;
        }
      }
    } catch (err) {
      console.error(err);
    }
  });
  return notifier;
};
