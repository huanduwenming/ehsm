const { 
  ehsm_keySpec_t, 
  ehsm_keyorigin_t,
  ehsm_keyusage_t,
  ehsm_digest_mode_t,
  ehsm_message_type_t,
  ehsm_padding_mode_t,
 } = require('./constant')
const { KMS_ACTION } = require('./apis')
const logger = require('./logger')
const {
  napi_result,
  _result,
  create_user_info,
  enroll_user_info,
  store_cmk,
  gen_hmac,
} = require('./function')
const {
  listKey,
  deleteALLKey,
  deleteKey,
  enableKey,
  disableKey,
} = require('./key_management_apis')
const {
  createSecret,
  updateSecretDesc,
  putSecretValue,
  listSecretVersionIds,
  listSecrets,
  describeSecret,
  deleteSecret,
  getSecretValue,
  restoreSecret
} = require('./secret_manager_apis')
const {
  generateQuote,
  verifyQuote,
  uploadQuotePolicy,
  getQuotePolicy
} = require('./quote_manager_apis')
/**
 *
 * @param {string} id (keyid|ukeyid)
 * @returns query (keyid|ukeyid) parameter
 *
 */
const cmk_db_query = (id) => {
  return {
    selector: {
      _id: `cmk:${id}`,
    },
    fields: ['keyBlob', 'creator', 'expireTime', 'keyState'],
    limit: 1,
  }
}
/**
 * Verify whether the request parameter appid is equal to creator in the database .
 * Verify expireTime , the expiration time cannot be less than the current time
 * @param {string} appid
 * @param {string} keyid
 * @param {object} res
 * @param {object} DB
 * @returns cmk_base64
 */
const find_cmk_by_keyid = async (appid, keyid, res, DB) => {
  const query = cmk_db_query(keyid)
  const cmk = await DB.partitionedFind('cmk', query)
  if (cmk.docs.length == 0) {
    res.send(_result(400, 'keyid error'))
    return false
  }
  const { keyBlob, creator, expireTime, keyState } = cmk.docs[0]
  if (appid != creator) {
    res.send(_result(400, 'appid error'))
    return false
  }
  if (keyState == 0 && keyState != null && keyState != undefined) {
    res.send(_result(400, 'keyid is disabled'))
    return false
  }
  if (new Date().getTime() > expireTime) {
    res.send(_result(400, 'keyid expire'))
    return
  }
  return keyBlob
}

const GetRouter = async (p) => {
  const { req, res, DB } = p
  const action = req.query.Action
  switch (action) {
    case KMS_ACTION.common.GetVersion:
      napi_res = napi_result(action, res, [])
      napi_res && res.send(napi_res)
      break;
    case KMS_ACTION.enroll.Enroll:
      enroll_user_info(action, DB, res, req)
      break;
    default:
      res.send(_result(404, 'API Not Found', {}))
      break
  }
}

const router = async (p) => {
  const { req, res, DB } = p
  const appid = req.body['appid']
  let payload = req.body['payload']
  if (payload == undefined) {
    payload = {}
  }
  const action = req.query.Action
  switch (action) {
    case KMS_ACTION.cryptographic.CreateKey:
      try {
        let { 
            keyspec,
            origin, 
            keyusage,
        } = payload
        /**
         * keyspec、origin convert to enum type
         * enum in thie constant.js file
         */
        keyspec = ehsm_keySpec_t[keyspec]
        origin = ehsm_keyorigin_t[origin]
        keyusage = ehsm_keyusage_t[keyusage]
        const napi_res = napi_result(action, res, { keyspec, origin, keyusage })
        napi_res && store_cmk(napi_res, res, appid, payload, DB)
      } catch (error) {
        logger.error(error)
        res.send(_result(500, 'Server internal error, please contact the administrator.'))
      }
      break
    case KMS_ACTION.cryptographic.Encrypt:
      try {
        const { keyid, plaintext, aad = '' } = payload
        const cmk_base64 = await find_cmk_by_keyid(appid, keyid, res, DB)
        const napi_res = napi_result(action, res, { cmk: cmk_base64, plaintext, aad })
        napi_res && res.send(napi_res)
      } catch (error) { }
      break
    case KMS_ACTION.cryptographic.Decrypt:
      try {
        const { keyid, ciphertext, aad = '' } = payload
        const cmk_base64 = await find_cmk_by_keyid(appid, keyid, res, DB)
        napi_res = napi_result(action, res, { cmk: cmk_base64, ciphertext, aad })
        napi_res && res.send(napi_res)
      } catch (error) {
        logger.error(error)
        res.send(_result(500, 'Server internal error, please contact the administrator.'))
      }
      break
    case KMS_ACTION.cryptographic.GetPublicKey:
      try {
        const { keyid } = payload
        const cmk_base64 = await find_cmk_by_keyid(appid, keyid, res, DB)
        napi_res = napi_result(action, res, { cmk: cmk_base64 })
        napi_res.result.keyid = keyid
        napi_res && res.send(napi_res)
      } catch (error) { }
      break
    case KMS_ACTION.cryptographic.GenerateDataKey:
      try {
        const { keyid, keylen, aad = '' } = payload
        const cmk_base64 = await find_cmk_by_keyid(appid, keyid, res, DB)
        napi_res = napi_result(action, res, { cmk: cmk_base64, keylen, aad })
        napi_res && res.send(napi_res)
      } catch (error) { }
      break
    case KMS_ACTION.cryptographic.GenerateDataKeyWithoutPlaintext:
      try {
        const { keyid, keylen, aad = '' } = payload
        const cmk_base64 = await find_cmk_by_keyid(appid, keyid, res, DB)
        napi_res = napi_result(action, res, { cmk: cmk_base64, keylen, aad })
        napi_res && res.send(napi_res)
      } catch (error) { }
      break
    case KMS_ACTION.cryptographic.Sign:
      try {
        let { keyid, message, message_type, padding_mode, digest_mode } = payload

        message_type = ehsm_message_type_t[message_type]
        padding_mode = ehsm_padding_mode_t[padding_mode]
        digest_mode = ehsm_digest_mode_t[digest_mode]

        const cmk_base64 = await find_cmk_by_keyid(appid, keyid, res, DB)
        napi_res = napi_result(action, res, { cmk: cmk_base64, message, message_type, padding_mode, digest_mode })
        napi_res && res.send(napi_res)
      } catch (error) { }
      break
    case KMS_ACTION.cryptographic.Verify:
      try {
        let { keyid, message, signature, message_type, padding_mode, digest_mode } = payload

        message_type = ehsm_message_type_t[message_type]
        padding_mode = ehsm_padding_mode_t[padding_mode]
        digest_mode = ehsm_digest_mode_t[digest_mode]
        
        const cmk_base64 = await find_cmk_by_keyid(appid, keyid, res, DB)
        napi_res = napi_result(action, res, { cmk: cmk_base64, message, signature, message_type, padding_mode, digest_mode })
        napi_res && res.send(napi_res)
      } catch (error) { }
      break
    case KMS_ACTION.cryptographic.AsymmetricEncrypt:
      try {
        let { keyid, plaintext, padding_mode } = payload
        padding_mode = ehsm_padding_mode_t[padding_mode]
        const cmk_base64 = await find_cmk_by_keyid(appid, keyid, res, DB)
        napi_res = napi_result(action, res, { cmk: cmk_base64, plaintext, padding_mode })
        napi_res && res.send(napi_res)
      } catch (error) { }
      break
    case KMS_ACTION.cryptographic.AsymmetricDecrypt:
      try {
        let { keyid, ciphertext, padding_mode } = payload
        padding_mode = ehsm_padding_mode_t[padding_mode]
        const cmk_base64 = await find_cmk_by_keyid(appid, keyid, res, DB)
        napi_res = napi_result(action, res, { cmk: cmk_base64, ciphertext, padding_mode })
        napi_res && res.send(napi_res)
      } catch (error) { }
      break
    case KMS_ACTION.cryptographic.ExportDataKey:
      try {
        const { keyid, ukeyid, aad = '', olddatakey_base } = payload
        const cmk_base64 = await find_cmk_by_keyid(appid, keyid, res, DB)
        const ukey_base64 = await find_cmk_by_keyid(appid, ukeyid, res, DB)
        napi_res = napi_result(action, res, { cmk: cmk_base64, ukey: ukey_base64, aad, olddatakey: olddatakey_base })
        napi_res && res.send(napi_res)
      } catch (error) { }
      break
    case KMS_ACTION.key_management.ListKey:
      listKey(appid, res, DB)
      break
    case KMS_ACTION.key_management.DeleteKey:
      deleteKey(appid, payload, res, DB)
      break
    case KMS_ACTION.key_management.DeleteAllKey:
      deleteALLKey(appid, res, DB)
      break
    case KMS_ACTION.key_management.EnableKey:
      enableKey(appid, payload, res, DB)
      break
    case KMS_ACTION.key_management.DisableKey:
      disableKey(appid, payload, res, DB)
      break
    case KMS_ACTION.remote_attestation.GenerateQuote:
      generateQuote(res, payload, action)
      break
    case KMS_ACTION.remote_attestation.VerifyQuote:
      verifyQuote(res, appid, payload, DB, action)
      break
    case KMS_ACTION.remote_attestation.UploadQuotePolicy:
      uploadQuotePolicy(res, appid, payload, DB)
      break
    case KMS_ACTION.remote_attestation.GetQuotePolicy:
      getQuotePolicy(res, appid, payload, DB)
      break
    case KMS_ACTION.secret_manager.CreateSecret:
      createSecret(res, appid, DB, payload)
      break
    case KMS_ACTION.secret_manager.UpdateSecretDesc:
      updateSecretDesc(res, appid, DB, payload)
      break
    case KMS_ACTION.secret_manager.PutSecretValue:
      putSecretValue(res, appid, DB, payload)
      break
    case KMS_ACTION.secret_manager.ListSecretVersionIds:
      listSecretVersionIds(res, appid, DB, payload)
      break
    case KMS_ACTION.secret_manager.ListSecrets:
      listSecrets(res, appid, DB, payload)
      break
    case KMS_ACTION.secret_manager.DescribeSecret:
      describeSecret(res, appid, DB, payload)
      break
    case KMS_ACTION.secret_manager.DeleteSecret:
      deleteSecret(res, appid, DB, payload)
      break
    case KMS_ACTION.secret_manager.GetSecretValue:
      getSecretValue(res, appid, DB, payload)
      break
    case KMS_ACTION.secret_manager.RestoreSecret:
      restoreSecret(res, appid, DB, payload)
      break

    default:
      res.send(_result(404, 'API Not Found', {}))
      break
  }
}

module.exports = {
  router,
  GetRouter
}
