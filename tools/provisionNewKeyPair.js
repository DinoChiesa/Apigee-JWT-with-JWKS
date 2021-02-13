// provisionNewKeyPair.js
// ------------------------------------------------------------------
// generate an public/private keypair and load into Apigee Edge KVM.
// The keypair will be either RSA 256-bit, or EC P-256.
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
      Getopt   = require('node-getopt'),
      version  = '20210212-1516',
      lib      = require('./lib/lib.js'),
      defaults = require('./config/defaults.js'),
      getopt   = new Getopt(common.commonOptions.concat([
        ['e' , 'env=ARG', 'required. the Apigee environment for which to store the KVM data'],
        ['S' , 'secretsmap=ARG', 'optional. name of the KVM in Apigee for private keys. Will be created (encrypted) if nec. Default: ' + defaults.secretsmap],
        ['N' , 'nonsecretsmap=ARG', 'optional. name of the KVM in Apigee for public keys, keyids, JWKS. Will be created if nec. Default: ' + defaults.nonsecretsmap]
      ])).bindHelp();

// ========================================================

console.log(
  'Apigee keypair provisioning tool, version: ' + version + '\n' +
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
    return Promise.resolve({})
      .then( _ => lib.loadKeysIntoMap(opt, org) )
      .then( _ => common.logWrite('ok. the new keys were loaded successfully.') );
  })
  .catch( e => console.error('error: ' + util.format(e) ));
