const debug = require('debug')('drachtio:sbc-rtpengine-sidecar');

module.exports = ({logger}) => {

  return (req, res) => {
    /* TODO: build this out with your logic */
    debug(req.uri, 'got incoming OPTIONS');
    res.send(200, {
      headers: {
        'User-agent': 'sbc-rtpengine-sidecar'
      }
    });
  };
};
