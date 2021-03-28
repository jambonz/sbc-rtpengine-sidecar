const assert = require('assert');
assert.ok(process.env.JAMBONES_SBCS, 'env var JAMBONES_SBCS is required and has not been supplied');
const Srf = require('drachtio-srf');
const srf = new Srf();
const opts = Object.assign({
  timestamp: () => {return `, "time": "${new Date().toISOString()}"`;}
}, {level: process.env.LOGLEVEL || 'info'});
const logger = require('pino')(opts);
const Client = require('rtpengine-client').WsClient;
const client = new Client(process.env.RTPENGINE_URL || 'ws://127.0.0.1:8080');
const sbcs = process.env.JAMBONES_SBCS.split(',');

srf.connect({
  host: process.env.DRACHTIO_HOST || '127.0.0.1',
  port: process.env.DRACHTIO_PORT || 9022,
  secret: process.env.DRACHTIO_SECRET || 'cymru'
});
srf.on('connect', async(err, hp) => {
  if (err) return logger.error({err}, 'Error connecting to drachtio');
  logger.info(`connected to drachtio listening on ${hp}`);
});

const getStats = async() => {
  try {
    const response = await client.statistics();
    logger.debug({response}, 'statistics');
    return response;
  } catch (err) {
    logger.error({err}, 'Error retrieving statistics');
  }
};

const pingSBC = async() => {
  const response = await getStats();
  if (response) {
    const {result, statistics} = response;
    const status = 'ok' === result ? 'open' : 'closed';
    const calls = 'ok' === result ? statistics.currentstatistics.sessionsown : 0;
    for (const sbc of sbcs) {
      srf.request(`sip:${sbc}`, {
        method: 'OPTIONS',
        headers: {
          'X-RTP-Status': status,
          'X-RTP-Calls': calls
        }
      });
    }
  }
};

client.on('listening', () => {
  logger.info('connected to rtpengine');
  setInterval(pingSBC, 45000);
  pingSBC();
});
