// lib.js
// ------------------------------------------------------------------
//
// created: Fri Feb 12 15:48:43 2021
// last saved: <2021-February-12 16:12:12>

/* jshint esversion:9, node:true, strict:implied */
/* global process, console, Buffer */

const apigeejs = require('apigee-edge-js'),
      common   = apigeejs.utility,
      jose     = require('node-jose'),
      crypto   = require('crypto'),
      defaults = require('../config/defaults.js');

const randomString = (L) => {
        L = L || 18;
        let s = '';
        do {s += Math.random().toString(36).substring(2, 15); } while (s.length < L);
        return s.substring(0,L);
      };

const newKeyPair = (keytype) =>
new Promise( (resolve, reject) => {
  let keygenOptions = {
        modulusLength: defaults.keystrength,
        namedCurve: defaults.ecCurve,
        publicKeyEncoding: { type: 'spki', format: 'pem' },
        privateKeyEncoding: { type: 'pkcs8', format: 'pem' }
      };
  crypto.generateKeyPair(keytype, keygenOptions,
                         function (e, publicKey, privateKey) {
                           if (e) { return reject(e); }
                           return resolve({publicKey, privateKey});
                         });
});


const re1 = new RegExp('(?:\r\n|\r|\n)', 'g');

const doOneKey = (opt, org) =>
(keytype) =>
newKeyPair(keytype)
  .then( ({publicKey, privateKey}) => {
    let kid = keytype + '__' + randomString(),
        publicKeyPem = publicKey.replace(re1,'\\n'),
        privateKeyPem = privateKey.replace(re1,'\\n'),
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
        options.key = 'currentKid__' + keytype;
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
            let keys = existingJwks ? JSON.parse(existingJwks.value).keys : [];
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


module.exports = {
  loadKeysIntoMap : (opt, org) => {
        let oneKey = doOneKey(opt, org);
        return oneKey('rsa').then( _ => oneKey('ec'));
      }
};
