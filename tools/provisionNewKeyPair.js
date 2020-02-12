// provisionNewKeyPair.js
// ------------------------------------------------------------------
// generate an RSA 256-bit keypair and load into Apigee Edge KVM
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


const edgejs     = require('apigee-edge-js'),
      common     = edgejs.utility,
      apigeeEdge = edgejs.edge,
      crypto     = require('crypto'),
      util       = require('util'),
      jose       = require('node-jose'),
      Getopt     = require('node-getopt'),
      version    = '20191217-1110',
      defaults   = { secretsmap : 'secrets', nonsecretsmap: 'settings', keystrength: 2048},
      getopt     = new Getopt(common.commonOptions.concat([
        ['e' , 'env=ARG', 'the Edge environment for which to store the KVM data'],
        ['b' , 'keystrength=ARG', 'optional. strength in bits of the RSA keypair. Default: ' + defaults.keystrength],
        ['S' , 'secretsmap=ARG', 'name of the KVM in Apigee for private keys. Will be created (encrypted) if nec. Default: ' + defaults.secretsmap],
        ['N' , 'nonsecretsmap=ARG', 'name of the KVM in Apigee for public keys, keyids, JWKS. Will be created if nec. Default: ' + defaults.nonsecretsmap]
      ])).bindHelp();

// ========================================================

function randomString(L){
  L = L || 18;
  let s = '';
  do {s += Math.random().toString(36).substring(2, 15); } while (s.length < L);
  return s.substring(0,L);
}

function newKeyPair() {
  return new Promise( (resolve, reject) => {
    let keygenOptions = {
          modulusLength: opt.options.keystrength,
          publicKeyEncoding: { type: 'spki', format: 'pem' },
          privateKeyEncoding: { type: 'pkcs8', format: 'pem' }
        };
    crypto.generateKeyPair('rsa', keygenOptions,
                           function (e, publicKey, privateKey) {
                             if (e) { return reject(e); }
                             return resolve({publicKey, privateKey});
                           });
   });
}

function loadKeysIntoMap(org) {
  let kid = randomString(),
      re = new RegExp('(?:\r\n|\r|\n)', 'g');

  return newKeyPair()
    .then( ({publicKey, privateKey}) => {
      let publicKeyPem = publicKey.replace(re,'\\n'),
          privateKeyPem = privateKey.replace(re,'\\n'),
          options = {
            env: opt.options.env,
            kvm: opt.options.secretsmap,
            key: 'private__' + kid,
            value: privateKey
          };
      common.logWrite('provisioning new key %s', kid);
      common.logWrite(privateKeyPem);
      return org.kvms.put(options)
        .then( _ => {
          options.kvm = opt.options.nonsecretsmap;
          options.key = 'public__' + kid;
          options.value = publicKey;
          return org.kvms.put(options);
        })
        .then( _ => {
          options.kvm = opt.options.nonsecretsmap;
          options.key = 'currentKid';
          options.value = kid;
          return org.kvms.put(options);
        })
        .then( _ => {
          options.kvm = opt.options.nonsecretsmap;
          options.key = 'jwks';
          delete options.value;
          return org.kvms.get(options)
            .then( result => {
              //console.log('kvm result: ' + util.format(result));
              let existingJwks = result.entry.find( x => x.name == 'jwks');
              //console.log(existingJwks);
              let keys = JSON.parse(existingJwks? existingJwks.value: "[]");
              let keystore = jose.JWK.createKeyStore();
              return keystore.add(publicKey, 'pem', {kid, use:'sig'})
                .then( result => {
                  keys.push(result.toJSON());
                  return org.kvms.put({...options, value: JSON.stringify({keys})});
                });
            })
            .then( _ => ({kid, publicKey, privateKey}));
        });
    });
}


// ========================================================

console.log(
  'Apigee Edge keypair provisioning tool, version: ' + version + '\n' +
    'Node.js ' + process.version + '\n');

common.logWrite('start');

// process.argv array starts with 'node' and 'scriptname.js'
var opt = getopt.parse(process.argv.slice(2));

if ( !opt.options.env ) {
  console.log('You must specify an environment');
  getopt.showHelp();
  process.exit(1);
}

if ( !opt.options.secretsmap ) {
  common.logWrite('defaulting to %s for privkeys map', defaults.secretsmap);
  opt.options.secretsmap = defaults.secretsmap;
}
if ( !opt.options.nonsecretsmap ) {
  common.logWrite('defaulting to %s for pubkeys map', defaults.nonsecretsmap);
  opt.options.nonsecretsmap = defaults.nonsecretsmap;
}

if ( ! opt.options.keystrength ) {
  common.logWrite('defaulting to %s for keystrength', defaults.keystrength);
  opt.options.keystrength = defaults.keystrength;
}

common.verifyCommonRequiredParameters(opt.options, getopt);

apigeeEdge.connect(common.optToOptions(opt))
  .then(org => {
    common.logWrite('connected');
    return Promise.resolve({})
      .then( _ => loadKeysIntoMap(org) )
      .then( _ => common.logWrite('ok. the new keys were loaded successfully.') );
  })
  .catch( e => console.error('error: ' + util.format(e) ));
