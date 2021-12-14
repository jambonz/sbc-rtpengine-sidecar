const assert = require('assert');
const noopLogger = {info: () => {}, error: () => {}};
const {LifeCycleEvents} = require('./constants');
const Client = require('rtpengine-client').WsClient;
const client = new Client(process.env.RTPENGINE_URL || 'ws://127.0.0.1:8080');
const Emitter = require('events');
const debug = require('debug')('jambonz:rtpengine-sidecar');

const getStats = async(logger) => {
  try {
    const response = await client.statistics();
    logger.debug({response}, 'statistics');
    return response;
  } catch (err) {
    logger.error({err}, 'Error retrieving statistics');
  }
};

module.exports = (logger) => {
  logger = logger || noopLogger;
  let sbcs = [];

  if (process.env.JAMBONES_SBCS) {
    sbcs = process.env.JAMBONES_SBCS
      .split(',')
      .map((sbc) => sbc.trim());
    assert.ok(sbcs.length, 'JAMBONES_SBCS env var is empty or misconfigured');
    logger.info({sbcs}, 'SBC inventory');
  }


  // listen for SNS lifecycle changes
  let lifecycleEmitter = new Emitter();
  let dryUpCalls = false;
  if (process.env.AWS_SNS_TOPIC_ARM) {

    (async function() {
      try {
        lifecycleEmitter = await require('./aws-sns-lifecycle')(logger);

        lifecycleEmitter
          .on(LifeCycleEvents.ScaleIn, async() => {
            logger.info('AWS scale-in notification: begin drying up calls');
            dryUpCalls = true;
            lifecycleEmitter.operationalState = LifeCycleEvents.ScaleIn;

            const {srf} = require('..');
            await pingProxies(srf);

            // if we have zero calls, we can complete the scale-in right
            const response = await getStats(logger);
            if (response) {
              const {result, statistics} = response;
              const calls = 'ok' === result ? statistics.currentstatistics.sessionsown : 0;
              if (calls === 0) {
                logger.info('scale-in can complete immediately as we have no calls in progress');
                lifecycleEmitter.completeScaleIn();
              }
              else {
                logger.info(`${calls} calls in progress; scale-in will complete when they are done`);
              }
            }
          })
          .on(LifeCycleEvents.StandbyEnter, () => {
            dryUpCalls = true;
            const {srf} = require('..');
            pingProxies(srf);

            logger.info('AWS enter pending state notification: begin drying up calls');
          })
          .on(LifeCycleEvents.StandbyExit, () => {
            dryUpCalls = false;
            const {srf} = require('..');
            pingProxies(srf);

            logger.info('AWS exit pending state notification: re-enable calls');
          });
      } catch (err) {
        logger.error({err}, 'Failure creating SNS notifier, lifecycle events will be disabled');
      }
    })();
  }

  const pingProxies = async(srf) => {
    try {
      const response = await getStats(logger);
      if (response) {
        const {result, statistics} = response;
        let status = 'ok' !== result || dryUpCalls ? 'closed' : 'open';
        const calls = 'ok' === result ? statistics.currentstatistics.sessionsown : 0;

        const {srf} = require('..');
        if (srf.locals.disabled) status = 'closed';
        for (const sbc of sbcs) {
          const req = await srf.request({
            uri: `sip:${sbc}`,
            method: 'OPTIONS',
            headers: {
              'X-RTP-Status': status,
              'X-RTP-Calls': calls
            }
          });
          req.on('response', (res) => {
            debug(`received ${res.status} from SBC`);
          });
        }
      }
    }  catch (err) {
      logger.error(err, 'Error sending OPTIONS ping');
    }
  };

  client.on('listening', async() => {
    logger.info('connected to rtpengine');
    const {srf} = require('..');

    // if SBCs are auto-scaling, monitor them as they come and go
    if (!process.env.JAMBONES_SBCS) {
      const {monitorSet} = srf.locals.dbHelpers;
      const setName = `${(process.env.JAMBONES_CLUSTER_ID || 'default')}:active-sip`;
      await monitorSet(setName, 10, (members) => {
        sbcs = members;
        logger.info(`sbc-pinger: SBC roster has changed, list of active SBCs is now ${sbcs}`);
      });
    }

    setInterval(pingProxies.bind(null, srf), process.env.OPTIONS_PING_INTERVAL || 30000);
    pingProxies(srf);
  });

  return {lifecycleEmitter, client};
};

