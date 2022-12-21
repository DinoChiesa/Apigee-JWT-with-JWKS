#! /usr/local/bin/node

// provisionProductAndApp.js
// ------------------------------------------------------------------
// provision an Apigee API Product, Developer, and App
//
// Copyright 2017-2022 Google LLC.
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
// last saved: <2022-December-20 18:41:10>

const apigeejs = require('apigee-edge-js'),
      common   = apigeejs.utility,
      apigee   = apigeejs.edge,
      util     = require('util'),
      path     = require('path'),
      jose     = require('node-jose'),
      crypto   = require('crypto'),
      sprintf  = require('sprintf-js').sprintf,
      Getopt   = require('node-getopt'),
      proxyDir = path.resolve(__dirname, '..'),
      version  = '20221220-1841',
      lib      = require('./lib/lib.js'),
      defaults = require('./config/defaults.js'),
      getopt   = new Getopt(common.commonOptions.concat([
        ['R' , 'reset', 'Optional. Reset, delete all the assets previously provisioned by this script.'],
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

function importAndDeploy(org) {
  return Promise.resolve({})
    .then(_ => org.proxies.import({source:proxyDir}))
    .then( result => org.proxies.deploy({name:result.name, revision:result.revision, environment:opt.options.env }) );
}

// ========================================================

console.log(
  'Apigee JWT-with-JWKS Example Provisioning tool, version: ' + version + '\n' +
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

const constants = {
        discriminators : {
          proxy        : 'jwt-with-jwks',
          product      : 'JWT-with-JWKS-Example-Product',
          developer    : 'jwt-with-jwks-developer@example.com',
          developerapp : 'JWT-with-JWKS-App'
        },
        descriptions : {
          product      : 'Test Product for JWT-with-JWKS Example',
          app          : 'Test App for JWT-with-JWKS Example'
        },
        note           : 'created '+ (new Date()).toISOString() + ' for JWT-with-JWKS Example',
        appExpiry      : '210d'
      };

apigee.connect(common.optToOptions(opt))
  .then( org => {
    common.logWrite('connected');
    if (opt.options.reset) {
      let delOptions = {
            app: { appName: constants.discriminators.developerapp, developerEmail: constants.discriminators.developer },
            developer:  { developerEmail: constants.discriminators.developer },
            product : { productName: constants.discriminators.product },
            proxy : { name: constants.discriminators.proxy }
          };

      // this will not work with GAAMBO
      let removeOneKvmEntry = name =>
        org.kvms.removeEntry({kvm : opt.options.nonsecretsmap, environment: opt.options.env, key : name})
        .catch( _ => {}) ;

      return Promise.resolve({})
        .then( _ => org.developerapps.del(delOptions.app).catch( _ => {}) )
        .then( _ => org.developers.del(delOptions.developer).catch( _ => {}) )
        .then( _ => org.products.del(delOptions.product).catch( _ => {}) )
        .then( _ => removeOneKvmEntry('jwks'))
        .then( _ =>
               // not possible to remove from encrypted KVM
          org.kvms.get({kvm : opt.options.nonsecretsmap, environment: opt.options.env})
            .then( result => {
              const reducer = (promise, name) =>
                promise .then( accumulator => removeOneKvmEntry(name));
              let propName = (org.isGoogle()) ? 'keyValueEntries' : 'entry';
              let toRemove = result[propName].map( e => e.name )
                .filter( name => name.startsWith("public__") || name == "currentKid");
              return toRemove.reduce(reducer, Promise.resolve([]));
            }))
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
              expiry         : constants.appExpiry,
              attributes     : { access: 'public', note: constants.note }
            })
          }
        };

    function conditionallyCreateEntity(entityType) {
      let collectionName = entityType + 's';
      return org[collectionName].get(options[collectionName].getOptions || {})
        .then( result => {
          if (result.apiProduct) {
            result = result.apiProduct.map(p => p.name); // gaambo
          }
          else if (result.developer) {
            result = result.developer.map(d => d.email); // gaambo
          }
          else if (collectionName == 'developerapps') {
            if (Object.keys(result).length == 0) {
              result = [];
            }
            if (result.app) {
              result = result.app.map(a => a.appId);
            }
          }
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
      .then( _ => lib.loadKeysIntoMap(opt, org) )
      .then( _ => importAndDeploy(org))
      .then( _ => conditionallyCreateEntity('product'))
      .then( _ => conditionallyCreateEntity('developer'))
      .then( _ => conditionallyCreateEntity('developerapp'))
      .then( result => {
        common.logWrite(sprintf('app1: %s', result.name));
        console.log();
        console.log('JWKS_ENDPOINT=https://$endpoint/jwt-with-jwks/jwks.json');
        console.log(sprintf('client_id=%s', result.credentials[0].consumerKey));
        console.log(sprintf('client_secret=%s', result.credentials[0].consumerSecret));
        console.log();
      })
      .then( _ => {
        console.log('curl -i -X POST \\');
        console.log('    -H content-type:application/x-www-form-urlencoded \\');
        console.log('    -u ${client_id}:${client_secret} \\');
        console.log('    -d grant_type=client_credentials \\');
        console.log('    -d alg=rsa \\');
        console.log('    https://$endpoint/jwt-with-jwks/oauth2-cc/token');
        console.log();
      });
  })
  .catch( e => console.log(util.format(e)) );
