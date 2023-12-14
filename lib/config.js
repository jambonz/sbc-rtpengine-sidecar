/* application options */
const LOGLEVEL = process.env.LOGLEVEL
const K8S = process.env.K8S
const JAMBONES_CLUSTER_ID = process.env.JAMBONES_CLUSTER_ID
const OPTIONS_PING_INTERVAL = process.env.OPTIONS_PING_INTERVAL
const JAMBONES_SBCS = process.env.JAMBONES_SBCS;
const RTPENGINE_URL = process.env.RTPENGINE_URL

/* dtmf options */
const RTPENGINE_DTMF_LOG_PORT = process.env.RTPENGINE_DTMF_LOG_PORT
const DTMF_ONLY = process.env.DTMF_ONLY

/* aws options */
const AWS_SNS_PORT = process.env.AWS_SNS_PORT
const AWS_REGION = process.env.AWS_REGION
const AWS_SNS_PORT_MAX = process.env.AWS_SNS_PORT_MAX
const AWS_SNS_TOPIC_ARM = process.env.AWS_SNS_TOPIC_ARM

/* drachtio */
const DRACHTIO_HOST = process.env.DRACHTIO_HOST
const DRACHTIO_PORT = process.env.DRACHTIO_PORT
const DRACHTIO_SECRET = process.env.DRACHTIO_SECRET

/* redis options */
const JAMBONES_REDIS_SENTINELS = process.env.JAMBONES_REDIS_SENTINELS
const JAMBONES_REDIS_SENTINEL_MASTER_NAME = process.env.JAMBONES_REDIS_SENTINEL_MASTER_NAME
const JAMBONES_REDIS_HOST = process.env.JAMBONES_REDIS_HOST
