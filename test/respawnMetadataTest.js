const assert = require('node:assert/strict')
const { EventEmitter } = require('node:events')
/* eslint-env mocha */
const inject = require('../lib/plugins/entities')

for (const [copyMetadata, keepsData] of [[0, false], [1, false], [2, true], [3, true], [false, false], [true, true], [undefined, false]]) {
  it(`respawn copyMetadata=${copyMetadata} ${keepsData ? 'preserves' : 'clears'} own metadata`, () => {
    const bot = new EventEmitter()
    bot.version = '1.21.4'
    bot.registry = require('prismarine-registry')(bot.version)
    bot.supportFeature = bot.registry.supportFeature
    bot._client = new EventEmitter()
    bot._client.username = 'Respawner'
    inject(bot)
    bot._client.emit('login', { entityId: 1 })
    const player = bot.entity
    bot.entities[2] = { id: 2, name: 'zombie', metadata: [1] }
    bot._client.emit('entity_metadata', { entityId: 1, metadata: [{ key: 0, type: 'byte', value: 1 }, { key: 1, type: 'int', value: 150 }] })
    bot._client.emit('respawn', { copyMetadata })
    assert.equal(bot.entity, player)
    assert.equal(bot.entities[2].metadata[0], 1)
    assert.equal(bot.entity.metadata[0], keepsData ? 1 : undefined)
    assert.equal(bot.entity.metadata[1], keepsData ? 150 : undefined)
    bot._client.emit('entity_metadata', { entityId: 1, metadata: [{ key: 0, type: 'byte', value: 0 }] })
    assert.equal(bot.entity.metadata[0], 0)
  })
}
