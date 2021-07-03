# verify-aws-sns-signature
An async function that [verifies the Signature](https://docs.aws.amazon.com/sns/latest/dg/sns-verify-signature-of-message.html) in an AWS SNS HTTP(S) POST request.  It takes one argument, which is an object representing the JSON body of the POST.
```
const {validatePayload} = require('verify-aws-sns-signature');

..
const verified = await validatePayload(payload);
```