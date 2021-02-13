// publicKeyTool.js
// ------------------------------------------------------------------
// lists the public keys registered in the Apigee KVM.
// or removes keys from that list.
//
// Copyright 2017-2021 Google LLC.
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

const apigeejs = require('apigee-edge-js'),
      common   = apigeejs.utility,
      apigee   = apigeejs.edge,
      util     = require('util'),
      jose     = require('node-jose'),
      Getopt   = require('node-getopt'),
      version  = '20210212-1542',
      defaults = require('./config/defaults.js'),
      getopt   = new Getopt(common.commonOptions.concat([
        ['e' , 'env=ARG', 'the Edge environment for which to store the KVM data'],
        ['S' , 'secretsmap=ARG', 'name of the KVM in Apigee for private keys.' + defaults.secretsmap],
        ['N' , 'nonsecretsmap=ARG', 'name of the KVM in Apigee for public keys, keyids, JWKS. Default: ' + defaults.nonsecretsmap],
        ['U' , 'update', 'update the JWKS with the available public keys.' + defaults.update],
        ['R' , 'remove=ARG+', 'names of keys to remove from the KVM.']
      ])).bindHelp();

// ========================================================

function listPublicKeys(org) {
  let p = Promise.resolve({});
  if (opt.options.remove) {
    // delete one or more entries
    const reducerA = (promise, item) =>
      promise .then( accumulator => {
        let options = {
              env: opt.options.env,
              kvm: opt.options.nonsecretsmap,
              entryName: 'public__' + item
            };
        return org.kvms.removeEntry(options)
          .then( result => [...accumulator, item ])
          .catch( e => accumulator );
      });

    p = p.then( _ =>
                opt.options.remove
                .reduce(reducerA, Promise.resolve([])));
  }

  p = p.then( _ => {
    let options = {
          env: opt.options.env,
          kvm: opt.options.nonsecretsmap
        };
    let keystore = jose.JWK.createKeyStore();
    common.logWrite('getting ...');
    return org.kvms.get(options)
      .then( result => {

        // The convention is:
        // The name shall be "public__TT__xxxxx" where
        // - TT is either rsa or ec
        // - xxxxx is a random string
        // - TT__xxxxx is the kid
        //
        // The value shall be a PEM-encoded public key (spki)
        let keys = result.entry
          .filter( e => e.name.startsWith('public__') && e.value.startsWith('-----BEGIN PUBLIC KEY-----'));

        // Convert each PEM into a JWK, being sure to catch formatting errors.
        const reducer1 = (promise, item) =>
          promise .then( accumulator => {
            let kid = item.name.replace('public__', '');
            return keystore.add(item.value, 'pem', {kid, use:'sig'})
              .then( result => [...accumulator, result.toJSON() ])
              .catch( e => accumulator );
          });

        return keys
          .reduce(reducer1, Promise.resolve([]));
      });
  });

  if (opt.options.update) {
    p =  p.then( arrayOfKeys =>
                 org.kvms.put({
                   env: opt.options.env,
                   kvm: opt.options.nonsecretsmap,
                   key : 'jwks',
                   value: JSON.stringify(arrayOfKeys)
                 })
                 .then( _ => arrayOfKeys ));
  }

  return p
    .then( arrayOfKeys => {
      common.logWrite('available keys: \n' + JSON.stringify(arrayOfKeys, null, 2));
      return arrayOfKeys;
    });
}

// ========================================================

console.log(
  'Apigee publickey management tool, version: ' + version + '\n' +
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

common.verifyCommonRequiredParameters(opt.options, getopt);

apigee.connect(common.optToOptions(opt))
  .then(org => {
    common.logWrite('connected');
    return org.kvms.get({ env: opt.options.env })
      .then( result => {
        let missingMaps = [opt.options.secretsmap,
                           opt.options.nonsecretsmap]
          .filter(v => result.indexOf(v) == -1 );

        if (missingMaps && missingMaps.length > 0) {
          return Promise.reject(new Error('missing: ['+ missingMaps.join(',') +']'));
        }

        return listPublicKeys(org);
      });
  })
  .catch( e => console.error('error: ' + util.format(e) ));
