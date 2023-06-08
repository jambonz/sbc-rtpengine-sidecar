const assert = require('assert');
const Srf = require('drachtio-srf');
const srf = new Srf();
const opts = Object.assign({
  timestamp: () => {return `, "time": "${new Date().toISOString()}"`;}
}, {level: process.env.LOGLEVEL || 'info'});
const logger = require('pino')(opts);
const {LifeCycleEvents} = require('./lib/constants');
require('./lib/dtmf-event-handler')(logger);
let privateIp;

const waitFor = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const noSip = process.env.K8S || process.env.DTMF_ONLY;
if (!noSip) {
  srf.connect({
    host: process.env.DRACHTIO_HOST || '127.0.0.1',
    port: process.env.DRACHTIO_PORT || 9022,
    secret: process.env.DRACHTIO_SECRET || 'cymru'
  });
  srf.on('connect', async(err, hp) => {
    if (err) return logger.error({err}, 'Error connecting to drachtio');
    logger.info(`connected to drachtio listening on ${hp}`);
    const arr = /^(.*)\/(.*):(\d+)$/.exec(hp);
    if (arr && 'udp' === arr[1]) {
      privateIp = arr[2];
      logger.info(`rtpengine is on private IP ${privateIp}`);
      srf.locals.host = privateIp;
    }
  });

  if (!process.env.JAMBONES_SBCS) {
    const StatsCollector = require('@jambonz/stats-collector');
    const stats = new StatsCollector(logger);
    if (process.env.JAMBONES_REDIS_SENTINELS) {
      assert.ok(process.env.JAMBONES_REDIS_SENTINEL_MASTER_NAME,
        'missing JAMBONES_REDIS_SENTINEL_MASTER_NAME env var, JAMBONES_REDIS_SENTINEL_PASSWORD env var is optional');
    } else {
      assert.ok(process.env.JAMBONES_REDIS_HOST, 'missing JAMBONES_REDIS_HOST env var');
    }

    const JAMBONES_REDIS_SENTINELS = process.env.JAMBONES_REDIS_SENTINELS ? {
      sentinels: process.env.JAMBONES_REDIS_SENTINELS.split(',').map((sentinel) => {
        let host, port = 26379;
        if (sentinel.includes(':')) {
          const arr = sentinel.split(':');
          host = arr[0];
          port = parseInt(arr[1], 10);
        } else {
          host = sentinel;
        }
        return {host, port};
      }),
      name: process.env.JAMBONES_REDIS_SENTINEL_MASTER_NAME,
      ...(process.env.JAMBONES_REDIS_SENTINEL_PASSWORD && {
        password: process.env.JAMBONES_REDIS_SENTINEL_PASSWORD
      }),
      ...(process.env.JAMBONES_REDIS_SENTINEL_USERNAME && {
        username: process.env.JAMBONES_REDIS_SENTINEL_USERNAME
      })
    } : null;

    const {monitorSet, removeFromSet} = require('@jambonz/realtimedb-helpers')(JAMBONES_REDIS_SENTINELS || {
      host: process.env.JAMBONES_REDIS_HOST,
      port: process.env.JAMBONES_REDIS_PORT || 6379
    }, logger);
    srf.locals = {...srf.locals,
      stats,
      dbHelpers: {
        monitorSet
      },
      disabled: false
    };
    const setNameRtp = `${(process.env.JAMBONES_CLUSTER_ID || 'default')}:active-rtp`;
    logger.info(`set for active rtp servers is ${setNameRtp}`);
    process.on('SIGUSR2', handle.bind(null, removeFromSet, setNameRtp));
    process.on('SIGTERM', handle.bind(null, removeFromSet, setNameRtp));
  }

  const {lifecycleEmitter, client} = require('./lib/sbc-pinger')(logger);

  /* if we are scaling in, check every so often if call count has gone to zero */
  setInterval(async() => {
    if (lifecycleEmitter.operationalState === LifeCycleEvents.ScaleIn) {
      const response = await client.statistics();
      if (response) {
        const {result, statistics} = response;
        const calls = 'ok' === result ? statistics.currentstatistics.sessionsown : 0;
        if (0 === calls) {
          logger.info('scale-in complete now that calls have dried up');
          lifecycleEmitter.scaleIn();
        }
      }
    }
  }, 20000);
}
else {
  const StatsCollector = require('@jambonz/stats-collector');
  const stats = new StatsCollector(logger);
  const Client = require('rtpengine-client').WsClient;
  let client;

  setInterval(async() => {
    try {
      if (!client) {
        const uri = process.env.RTPENGINE_URL || 'ws://127.0.0.1:8080';
        try {
          client = new Client(uri);
          await waitFor(1000);
        } catch (err) {
          logger.error({err}, `Error connecting to rtpengine at ${uri}`);
          return;
        }
      }

      const response = await client.statistics();
      const {result, statistics} = response;
      const calls = 'ok' === result ? statistics.currentstatistics.sessionsown : 0;
      stats.gauge('sbc.media.calls.count', calls);
    } catch (err) {
      logger.error({err}, 'Error in stats collection');
    }
  }, process.env.OPTIONS_PING_INTERVAL || 30000);
}

function handle(removeFromSet, setName, signal) {
  logger.info(`got signal ${signal}, removing ${privateIp} from set ${setName}`);
  removeFromSet(setName, privateIp);
  srf.locals.disabled = true;
}

module.exports = {srf, logger};
