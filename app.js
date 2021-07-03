const Srf = require('drachtio-srf');
const srf = new Srf();
const opts = Object.assign({
  timestamp: () => {return `, "time": "${new Date().toISOString()}"`;}
}, {level: process.env.LOGLEVEL || 'info'});
const logger = require('pino')(opts);
const {LifeCycleEvents} = require('./lib/constants');

srf.connect({
  host: process.env.DRACHTIO_HOST || '127.0.0.1',
  port: process.env.DRACHTIO_PORT || 9022,
  secret: process.env.DRACHTIO_SECRET || 'cymru'
});
srf.on('connect', async(err, hp) => {
  if (err) return logger.error({err}, 'Error connecting to drachtio');
  logger.info(`connected to drachtio listening on ${hp}`);
});

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

module.exports = {srf, logger};
