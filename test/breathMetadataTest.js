/* eslint-env mocha */

const assert = require('assert')
const { EventEmitter } = require('events')
const inject = require('../lib/plugins/entities')

describe('player breath metadata', () => {
  it('keeps other entities air supply out of the bot oxygen level and breath events', () => {
    const bot = new EventEmitter()
    bot.version = '1.21.4'
    bot.registry = require('prismarine-registry')(bot.version)
    bot.supportFeature = bot.registry.supportFeature
    bot._client = new EventEmitter()
    bot._client.username = 'Breather'
    inject(bot)
    bot._client.emit('login', { entityId: 1 })
    bot.entities[2] = { id: 2, name: 'dolphin', metadata: {} }
    const airKey = bot.registry.entitiesByName.player.metadataKeys.indexOf('air_supply')
    const breath = []
    bot.on('breath', () => breath.push(bot.oxygenLevel))
    const send = (entityId, value) => bot._client.emit('entity_metadata', {
      entityId,
      metadata: [{ key: airKey, type: 'int', value }]
    })

    send(1, 150)
    send(2, 6000)
    assert.strictEqual(bot.oxygenLevel, 10)
    assert.deepStrictEqual(breath, [10])
    assert.strictEqual(bot.entities[2].metadata[airKey], 6000)
    send(1, 300)
    assert.strictEqual(bot.oxygenLevel, 20)
    assert.deepStrictEqual(breath, [10, 20])
  })
})
