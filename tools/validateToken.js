// validateToken.js
// ------------------------------------------------------------------
// validate a token using a JWKS
//
// Copyright 2017-2019 Google LLC.
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     https://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.
//

/* jshint esversion:9, node:true, strict:implied */
/* global process, console, Buffer */

const jose       = require('node-jose'),
      crypto     = require('crypto'),
      request    = require('request'),
      util       = require('util'),
      Getopt     = require('node-getopt'),
      version    = '20191119-0745',
      reSignedJwt = new RegExp('^([^\\.]+)\\.([^\\.]+)\\.([^\\.]+)$'),
      getopt     = new Getopt([
        ['t' , 'token=ARG', 'required. the JWT to validate.'],
        ['e' , 'endpoint=ARG', 'required. the JWKS endpoint holding the keys']
      ]).bindHelp();

// ========================================================

function logWrite() {
  var time = (new Date()).toString(),
      tstr = '[' + time.substr(11, 4) + '-' +
    time.substr(4, 3) + '-' + time.substr(8, 2) + ' ' +
    time.substr(16, 8) + '] ';
  console.log(tstr + util.format.apply(null, arguments));
}

function httpRequest(options, cb) {
  logWrite('%s %s', options.method.toUpperCase(), options.url);
  if (options.method  && options.method.toLowerCase() == 'post') {
    logWrite('   %s', options.body);
  }
  return request(options, function(error, httpResponse, body) {
    logWrite('==> %d', httpResponse.statusCode);
    if (httpResponse.statusCode == 404){
      console.log(body);
    }
    return cb(error, httpResponse, body);
  });
}


function requestPromise(requestOptions) {
  return new Promise((resolve, reject) => {
    httpRequest(requestOptions, function(error, httpResponse, body) {
      if (error) {
        return reject(error);
      }
      body = JSON.parse(body);
      return resolve(body);
    });
  });
}

console.log(
  'Apigee token validating example, version: ' + version + '\n' +
    'Node.js ' + process.version + '\n');

logWrite('start');

// process.argv array starts with 'node' and 'scriptname.js'
var opt = getopt.parse(process.argv.slice(2));

if ( !opt.options.token ) {
  console.log('You must specify a token');
  getopt.showHelp();
  process.exit(1);
}
if ( !opt.options.endpoint ) {
  console.log('You must specify a JWKS endpoint');
  getopt.showHelp();
  process.exit(1);
}

let matches = reSignedJwt.exec(opt.options.token);
if ( ! matches || matches.length != 4) {
  logWrite('that does not appear to be a signed JWT');
  process.exit(1);
}

let requestOptions = {
      url : opt.options.endpoint,
      headers : {
        'accept': 'application/json'
      },
      method : 'get'
    };

requestPromise(requestOptions)
  .then(jwks => {
    logWrite('jwks: ' + JSON.stringify(jwks));
    let json = Buffer.from(matches[1], 'base64').toString();  // base64-decode
    logWrite('header: ' + json);
    let header = JSON.parse(json);
    let foundKey = jwks.keys.find( x => x.kid == header.kid);
    if (foundKey) {
      return jose.JWK.asKey(foundKey, 'json')
        .then(result =>
              // {result} is a jose.JWK.Key
              // {result.keystore} is a unique jose.JWK.KeyStore
              jose.JWS.createVerify(result.keystore)
              .verify(opt.options.token)
              .then(result => {
                // {result} is a Object with:
                // *  header: the combined 'protected' and 'unprotected' header members
                // *  payload: Buffer of the signed content
                // *  signature: Buffer of the verified signature
                // *  key: The key used to verify the signature
                logWrite('Signature VERIFIED');
                logWrite('payload: ' + result.payload);
              }));
    }
    else {
      console.log('cannot find a matching key for %s...', header.kid);
    }
  })
  .catch( e => console.error('\nerror: ' + util.format(e) ));
