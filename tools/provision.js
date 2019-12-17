#! /usr/local/bin/node

// provisionProductAndApp.js
// ------------------------------------------------------------------
// provision an Apigee API Product, Developer, and App
//
// Copyright 2017-2019 Google LLC.
//

/* jshint esversion: 9, strict:implied, node:true */

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
// last saved: <2019-December-17 11:07:40>

const edgejs     = require('apigee-edge-js'),
      common     = edgejs.utility,
      apigeeEdge = edgejs.edge,
      util       = require('util'),
      path       = require('path'),
      jose       = require('node-jose'),
      crypto     = require('crypto'),
      sprintf    = require('sprintf-js').sprintf,
      Getopt     = require('node-getopt'),
      proxyDir   = path.resolve(__dirname, '..'),
      version    = '20191217-1051',
      defaults   = { secretsmap : 'secrets', nonsecretsmap: 'settings', keystrength: 2048},
      getopt     = new Getopt(common.commonOptions.concat([
        ['R' , 'reset', 'Optional. Reset, delete all the assets previously provisioned by this script.'],
        ['b' , 'keystrength=ARG', 'optional. strength in bits of the RSA keypair. Default: ' + defaults.keystrength],
        ['S' , 'secretsmap=ARG', 'name of the KVM in Apigee for private keys. Will be created (encrypted) if nec. Default: ' + defaults.secretsmap],
        ['N' , 'nonsecretsmap=ARG', 'name of the KVM in Apigee for public keys, keyids, JWKS. Will be created if nec. Default: ' + defaults.nonsecretsmap], 
        ['e' , 'env=ARG', 'required. the Apigee environment to provision for this example. ']
      ])).bindHelp();

// ========================================================

function insureOneMap(org, r, mapname, encrypted) {
  if (r.indexOf(mapname) == -1) {
    return org.kvms.create({ environment: opt.options.env, name: mapname, encrypted})
      .then( () => r );
  }
  return r;
}

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
              existingJwks = (existingJwks) ? JSON.parse(existingJwks.value) : { keys : []};
              //console.log('existingJwks: ' + JSON.stringify(existingJwks));

              let keystore = jose.JWK.createKeyStore();
              return keystore.add(publicKey, 'pem', {kid, use:'sig'})
                .then( result => {
                  existingJwks.keys.push(result.toJSON());
                  return org.kvms.put({...options, value: JSON.stringify(existingJwks) });
                });
            })
            .then( _ => ({kid, publicKey, privateKey}));
        });
    });
}

function importAndDeploy(org) {
  return Promise.resolve({})
    .then(_ => org.proxies.import({source:proxyDir}))
    .then( result => org.proxies.deploy({name:result.name, revision:result.revision, environment:opt.options.env }) );
}

// ========================================================

console.log(
  'Apigee Edge JWT-with-JWKS Example Provisioning tool, version: ' + version + '\n' +
    'Node.js ' + process.version + '\n');

common.logWrite('start');
let opt = getopt.parse(process.argv.slice(2));
common.verifyCommonRequiredParameters(opt.options, getopt);

if ( ! opt.options.env) {
  console.log('you must specify an environment.');
  getopt.showHelp();
  process.exit(1);
}

if ( ! opt.options.secretsmap) {
  console.log('defaulting to secrets map: ' + defaults.secretsmap);
  opt.options.secretsmap = defaults.secretsmap;
}

if ( ! opt.options.nonsecretsmap) {
  console.log('defaulting to settings map: ' + defaults.nonsecretsmap);
  opt.options.nonsecretsmap = defaults.nonsecretsmap;
}

if ( ! opt.options.keystrength ) {
  common.logWrite('defaulting to %s for keystrength', defaults.keystrength);
  opt.options.keystrength = defaults.keystrength;
}

const constants = {
        discriminators : {
          proxy        : 'jwt-with-jwks',
          product      : 'JWT-with-JWKS-Example-Product',
          developer    : 'JWT-with-JWKS-Developer@example.com',
          developerapp : 'JWT-with-JWKS-App'
        },
        descriptions : {
          product      : 'Test Product for JWT-with-JWKS Example',
          app          : 'Test App for JWT-with-JWKS Example'
        },
        note           : 'created '+ (new Date()).toISOString() + ' for JWT-with-JWKS Example',
        appExpiry      : '210d'
      };

apigeeEdge.connect(common.optToOptions(opt))
  .then( org => {
    common.logWrite('connected');
    if (opt.options.reset) {
      let delOptions = {
            app: { appName: constants.discriminators.developerapp, developerEmail: constants.discriminators.developer },
            developer:  { developerEmail: constants.discriminators.developer },
            product : { productName: constants.discriminators.product },
            proxy : { name: constants.discriminators.proxy }
          };

      return Promise.resolve({})
        .then( _ => org.developerapps.del(delOptions.app).catch( _ => {}) )
        .then( _ => org.developers.del(delOptions.developer).catch( _ => {}) )
        .then( _ => org.products.del(delOptions.product).catch( _ => {}) )
        .then( _ =>
               org.proxies.get( delOptions.proxy )
               .then( proxy => {
                 //console.log('GET proxy : ' + JSON.stringify(proxy));
                 return org.proxies.getDeployments( delOptions.proxy )
               .then( deployments =>
                   org.proxies.undeploy({
                      ...delOptions.proxy,
                      environment: deployments.environment[0].name,
                      revision:deployments.environment[0].revision[0].name
                   }));
               })
               .then( _ => org.proxies.del( delOptions.proxy ).catch( _ => {}) )
               .catch( _ => {}) )
        .then( _ => common.logWrite(sprintf('ok. demo assets have been deleted')) );
    }

    let options = {
          products: {
            creationOptions: () => ({
              productName  : constants.discriminators.product,
              description  : constants.descriptions.product,
              proxies      : [constants.discriminators.proxy],
              attributes   : { access: 'public', note: constants.note },
              approvalType : 'auto'
            })
          },
          developers: {
            creationOptions: () => ({
              developerEmail : constants.discriminators.developer,
              lastName       : 'Developer',
              firstName      : 'Developer',
              userName       : 'JWT-with-JWKS-Developer',
              attributes     : { note: constants.note }
            })
          },
          developerapps: {
            getOptions: {
              developerEmail : constants.discriminators.developer
            },
            creationOptions: () => ({
              appName        : constants.discriminators.developerapp,
              developerEmail : constants.discriminators.developer,
              productName    : constants.discriminators.product,
              description    : constants.descriptions.app,
              expiry         : '210d',
              attributes     : { access: 'public', note: constants.note }
            })
          }
        };

    function conditionallyCreateEntity(entityType) {
      let collectionName = entityType + 's';
      return org[collectionName].get(options[collectionName].getOptions || {})
        .then( result => {
          let itemName = constants.discriminators[entityType];
          if (result.indexOf(itemName)>=0) {
            if (collectionName == 'developerapps') {
              return org[collectionName].get({
                developerEmail : constants.discriminators.developer,
                appName        : itemName
              });
            }
            return Promise.resolve(result) ;
          }

          return org[collectionName].create(options[collectionName].creationOptions());
        });
    }

    return Promise.resolve({})
      .then( _ => org.kvms.get({ environment: opt.options.env }))
      .then( r => insureOneMap(org, r, opt.options.secretsmap, true))
      .then( r => insureOneMap(org, r, opt.options.nonsecretsmap, false))
      .then( _ => loadKeysIntoMap(org) )
      .then( _ => importAndDeploy(org))
      .then( _ => conditionallyCreateEntity('product'))
      .then( _ => conditionallyCreateEntity('developer'))
      .then( _ => conditionallyCreateEntity('developerapp'))
      .then( result => {
        common.logWrite(sprintf('app1: %s', result.name));
        console.log();
        console.log(sprintf('client_id=%s', result.credentials[0].consumerKey));
        console.log(sprintf('client_secret=%s', result.credentials[0].consumerSecret));
        console.log();
      })
      .then( _ => {
        console.log('curl -i -X POST \\');
        console.log('    -H content-type:application/x-www-form-urlencoded \\');
        console.log('    -u ${client_id}:${client_secret} \\');
        console.log('    -d grant_type=client_credentials \\');
        console.log('    https://$ORG-$ENV.apigee.net/jwt-with-jwks/oauth2-cc/token');
        console.log();
      });
  })
  .catch( e => console.log(util.format(e)) );
