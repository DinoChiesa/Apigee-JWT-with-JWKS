# Apigee example: Generate JWT and expose JWKS

Apigee does not include a builtin management for .JWKS content.
But it's not difficult to build this yourself.

This example shows how you might use Apigee to
generate JWT signed with RSA keys, and also publish a .jwks endpoint containing
public keys, which allows external clients to verify the JWT.

## Disclaimer

This example is not an official Google product, nor is it part of an
official Google product.

## Background

First, let's address a common misunderstanding. Some people think that verifying JWTs requires a JWKS endpoint.

This isn't true.

It is possible to use a JWKS to verify a JWT, whether you do the verification
within Apigee, or using some other
tool or technology. But a JWKS is not required. This is true if you do the
verification in Apigee, or if you use some other tool, platform, or technology.

To  verify a signed JWT, you need a public key. JWKS is a handy way of publishing a list of
public keys; each key can be
distinguished by a unique key identifier known as a `kid`. So a JWKS is
sufficient but not necessary.

A JWKS (aka JSON Web Key Set) looks like this:
```
{
  "keys": [
    {"kty":"EC","crv":"P-256","kid":"2775c10b","x":"j5J5MsLy8KSXzEg6iDccIefx7DpXegiMmKkn6vkHmFw","y":"Sy0ImntHK0NBn0GnPw1DKd1wbpdMGyelvQBmN2ZP0Bs"},
    {"kty":"RSA","e":"AQAB","use":"sig","kid":"5601c05a","n":"gunSksQIlGfpul5q_hmwRtRor1E6eYRT9XTS-_UhZE0yO4lv0iZY5BnElzjmsuBa1bkjNBKyfASaa5_fj71eYwbz-O3iltfRmQ9wm4X_jWTtRL4xE6hydDR7o1CS7_rNdKcKjD88rhcNQmhxDZarVVSH7OYcndGgisLolo2w6lk3SN_j55AqzF2O4DGDyX-zXvv4DcEVSsprsizteZXxMGJoVKGsEx-kxoAn1OUB4CnkorWwqOiJ_RSHpd6X8fhRoWG_wEwmnd-0FFQmn3sNaR2CFmR9WHYhuDEj1VeKCMmZ_Xjh-lB2EMpyUNDug0c7tuo2EWkYxkBRJmrkrsCy5w"}
  ]
}
```

Each item in the "keys" array identifies a public key. Because these keys are
"public", they can be shared freely. The verifying app or
system can retrieve the JWKS payload from a well-known endpoint, and
then select one of the keys in the list to use. Normally this is done with the
kid; the JWT that will be verified includes a `kid` value in the header, and the
verifying app just selects the key from the JWKS with the matching kid. Easy.


## Use Apigee to Generate a JWT that can be verified via a .jwks endpoint

Here's what's necessary.

- offline setup:
  - generate a keypair and contrive a random keyid
  - store the privatekey (PEM encoded) into encrypted KVM with the keyid as part of the KVM key
  - store the current keyid into regular KVM
  - store the JWKS conteent in regular KVM

- to issue the JWT, configure a flow to:
  - retrieve the current keyid from KVM
  - retrieve the private key from the encrypted KVM using the current keyid
  - call GenerateJWT with that privatekey

- to support publishing the .JWKS, use a separate flow to:
  - retrieve the .jwks content from KVM
  - use AssignMessage to assign a response

When the verifying app wants to verify that JWT, it should:
- receive the JWT from ... something
- retrieve the .jwks endpoint. This data can be cached, usually for the lifetime of a JWT.
- decode the JWT header to find the kid
- use the kid to select the public key
- use that public key to verify the signature on the JWT
- rely on the claims in the verified JWT


This example will include:
- an API proxy configured to behave as described above
- a management tool to provision new keypairs
- an example client to verify an Apigee-generated JWT
  using the .JWKS


## To use

Prerequisites:
* node v10+
* npm v6+
* the curl utility
* an apigee org + environment
* A terminal shell 

1. Prepare:
   Open the terminal shell. cd into the tools directory.
   ```
   cd tools
   npm install
   ```

2. Setup:
   ```
   # Set environment
   ORG=myorg
   ENV=myenv

   # provision the KVM
   node ./provisionNewKeyPair.js -n -v -o $ORG -e $ENV

   # Deploy the proxy
   node ./importAndDeploy.js -v -u myapigeeid@example.com -o $ORG -e $ENV -d ../
   ```

3. get a client id and secret from Apigee. Then set them into your terminal environment:
   ```
   client_id=baaadbeefeiodxkjkdjdlk
   client_secret=foobarlkls
   ```

4. Invoke the example proxy to Get a token:
   ```
   curl -i -X POST -H content-type:application/x-www-form-urlencoded \
      -u ${client_id}:${client_secret} \
      "https://${ORG}-${ENV}.apigee.net/jwt-with-jwks/oauth2-cc/token" \
      -d 'grant_type=client_credentials'
   ```

   The result should look like:
   ```
   HTTP/1.1 200 OK
   Date: Tue, 19 Nov 2019 16:15:32 GMT
   Content-Type: application/json
   Content-Length: 774
   Connection: keep-alive

   {
       "jwt" : "eyJraWQiOiJzemhhc2x0MHZ2OXlyNjU0ODMiLCJ0eXAiOiJKV1QiLCJhbGciOiJSUzI1NiJ9.eyJhY2Nlc3NfdG9rZW4iOiJLUGUwWGJudkFNZXhLcFI1VXdLUFAxdXZqekJVZGNndzhLY09RRWw5UWNtWlpDUFoiLCJpc3MiOiJodHRwczpcL1wvZ2FjY2VsZXJhdGUzLXRlc3QuYXBpZ2VlLm5ldFwvand0LXdpdGgtandrcyIsImV4cCI6MTU3NDE4MTkzMiwiaWF0IjoxNTc0MTgwMTMyLCJjbGllbnRfaWQiOiJwcUFOSTV1QXdpTWw1VEludGo5b0gwdFBzWW5vMTlRMSIsImp0aSI6IjIxNDY5MzcxLTAwMWQtNGI1NS04NGNlLWU1YjFjYTA4MDA3NyJ9.lDeF6MMd8DSRGVkvhitWeDnEVSHucjb_YclcykqVXcDxfiZ2MFwaml3Re3K3IowJJvjjsxKyhJJnkDl0DhpRVBhDI7Iu-ku44Dg4X7Fu8-fGCdMWX9O_879UvMqUSjWQ-kMKm_Xv1QOTqCvGbRdzcp6b98QSrtQ-kO0UqgZqIcYNPSVbwDzerEjWQzDPaFa9DyC8JqFE5LD9pCY27FE2gvys1G2HRglUCdavff2ghXRr8vG2gEI5-tk9rNp4XR3lUtox-Hj2m-Q1yYSA586K0GD8ieLjzFIOH_ipFikkMXL1YAKgUivqgUD6XZgOYk8ZfyYHdmil0kIwB1V4eNqTRQ"
   }
   ```

5. Verify that token:
   ```
   JWKS_ENDPOINT=https://${ORG}-${ENV}.apigee.net/jwt-with-jwks/jwks.json
   JWT=TOKEN_FROM_ABOVE

   node ./validateToken.js -e $JWKS_ENDPOINT -t $JWT 
   ```

   You should see a happy message saying the token was verified.
   You can then repeat steps 3 and 4 multiple times.


Later, you can Generate and provision a new keypair.
```
node ./provisionNewKeyPair.js -n -v -o $ORG -e $ENV
```

This will update the KVM that stores the "currentKid" to point to the new public
key and new private key.  It also updates the JWKS content in the KVM.

Subsequent requests for a token (step 4) will use the new key pair.
and verification (step 5) will continue to work as before, using the new key.
Keep in mind the data for the current key and JWKS is cached in the Apigee gateway,
for 180s.


## The tools

All of the supporting tools are written in nodejs.

* [provisionNewKeyPair.js](./tools/provisionNewKeyPair.js) - generates a new RSA
  public/private keypair, and loads the keys into the Apigee KVM. Private keys
  go into an encrypted KVM, while public keys go into a non-encrypted KVM.
  Also loads the JWKS content into the non-encrypted KVM.
  This latter is used to fulfill requests to the jwks endpoint.

* [validateToken.js](./tools/validateToken.js) - validates a token generated by
  Apigee, using the `node-jose` library, and retrieving the public key from the
  public JWKS endpoint.

* [importAndDeploy.js](./tools/importAndDeploy.js) - imports the example proxy bundle
  to  Apigee, and deploys it.

## Support

This example is not a supported part of
Apigee.  If you need assistance, you can try inquiring on [The
Apigee Community Site](https://community.apigee.com).  There is no
service-level guarantee for responses to inquiries regarding this
callout.

## License

The material in this repo is copyright (c) 2019
Google LLC and is licensed under the [Apache 2.0
License](LICENSE). This includes the JavaScript code as well as the API
Proxy configuration.

## Bugs

* The provisioning tool does not remove keys from the JWKS payload when they are
  rotated out. As a result, the JWKS payload grows without bound when you re-run
  provisionNewKeyPair.js.  This could be accomplished by storing a date in the
  KVM that marks when each particular keypair was provisioned. The script could
  compare that data with "now", and then reap old private and public keys, and
  updating the JWKS appropriately, when the date is "old" (let's say, more than
  1 or 2 months out of date).
