const assert = require('node:assert/strict')
const { EventEmitter } = require('node:events')
/* eslint-env mocha */
const inject = require('../lib/plugins/entities')

for (const version of ['1.12.2', '1.21.4']) {
  it(`${version} reconciles partial pickup after collection listeners, then accepts metadata and removal`, () => {
    const bot = new EventEmitter()
    bot.version = version
    bot.registry = require('prismarine-registry')(version)
    bot.supportFeature = bot.registry.supportFeature
    bot._client = new EventEmitter()
    bot._client.username = 'Collector'
    inject(bot)
    bot._client.emit('login', { entityId: 1 })
    const Entity = require('prismarine-entity')(version)
    const Item = require('prismarine-item')(version)
    const item = new Entity(2)
    item.name = 'item'
    bot.entities[2] = item
    const key = bot.registry.supportFeature('metadataIxOfItem')
    const metadata = (count) => bot._client.emit('entity_metadata', { entityId: 2, metadata: [{ key, type: 'slot', value: Item.toNotch(new Item(bot.registry.itemsByName.gold_ingot.id, count, 0)) }] })
    metadata(3)
    const during = []
    bot.on('playerCollect', (collector, collected) => {
      assert.equal(collector, bot.entity)
      assert.equal(collected, item)
      during.push(collected.getDroppedItem()?.count)
    })
    const collect = (pickupItemCount) => bot._client.emit('collect', { collectorEntityId: 1, collectedEntityId: 2, pickupItemCount })
    collect(1)
    assert.equal(item.getDroppedItem().count, 2)
    collect(1)
    assert.equal(item.getDroppedItem().count, 1)
    metadata(5)
    assert.equal(item.getDroppedItem().count, 5)
    collect(undefined)
    assert.equal(item.getDroppedItem().count, 5, 'missing protocol count cannot establish a remainder')
    collect(5)
    assert.equal(item.getDroppedItem(), null)
    assert.equal(bot.entities[2], item, 'only entity_destroy owns removal')
    assert.deepEqual(during, [3, 2, 5, 5])
    let gone = 0
    bot.on('entityGone', () => gone++)
    bot._client.emit('entity_destroy', { entityIds: [2] })
    assert.equal(bot.entities[2], undefined)
    assert.equal(gone, 1)
  })
}
