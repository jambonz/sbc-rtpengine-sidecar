# sbc-rtpengine-sidecar

This application was created with the [create drachtio command](https://www.npmjs.com/package/create-drachtio-app).  This documentation was generated at the time when the project was generated and describes the functionality that was initially scaffolded.  Of course, you should feel free to modify or replace this documentation as you build out your own logic.

## Configuration

Configuration is provided via environment variables:

| variable | meaning | required?|
|----------|----------|---------|
|AWS_REGION| aws region | no|
|AWS_SNS_PORT| tcp port to listen on for AWS SNS requests |no|
|DTMF_ONLY| run in DTMF only mode |no|
|RTPENGINE_DTMF_LOG_PORT| listening port for rtp events from rtpengine |yes|
|RTPENGINE_URL| rtpengine websocket url |no|
|DRACHTIO_HOST| ip address of drachtio server (typically '127.0.0.1') |no|
|DRACHTIO_PORT| listening port of drachtio server for control connections (typically 9022) |no|
|DRACHTIO_SECRET| shared secret |no|
|JAMBONES_CLUSTER_ID| cluster id |no|
|JAMBONES_LOGLEVEL| log level for application, 'info' or 'debug' |no|
|JAMBONES_REDIS_HOST| redis host |no|
|JAMBONES_REDIS_PORT| redis port |no|
|JAMBONES_SBCS| list of IP addresses (on the internal network) of SBCs, comma-separated |no|
|OPTIONS_PING_INTERVAL| SIP OPTIONS interval |no|
|K8S| service running as kubernetes service |no|

## SIP Request Handling

Based on the options that you have chosen,this application handles the following incoming SIP requests:

### OPTIONS
The generated application responds with 200 to incoming OPTIONS messages (you should implement your own logic as appropriate).

## Tests
Well, you chose not to generate the test suite when you generated the project so we got nothing for you.  You may want to go back and re-generate the project using the `--test` flag to get an initial docker-based test suite.  Just a suggestion.
