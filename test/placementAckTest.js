const assert = require('node:assert/strict')
const { EventEmitter } = require('node:events')
const { it: test, describe } = require('mocha')
const { Vec3 } = require('vec3')
const { nextInteractionSequence } = require('../lib/interaction_sequence')
const turn = () => new Promise(resolve => setImmediate(resolve))
function fixture (version = '1.21.4') {
  const bot = new EventEmitter()
  bot.version = version
  bot.registry = require('prismarine-registry')(version)
  bot.supportFeature = bot.registry.supportFeature
  bot._client = new EventEmitter()
  bot.entity = { id: 1, yaw: 0, pitch: 0 }
  bot.lookAt = async () => {}
  bot.swingArm = () => {}
  const Item = require('prismarine-item')(bot.registry)
  bot.heldItem = new Item(bot.registry.itemsByName.cobblestone.id, 2)
  const target = new Vec3(0, 64, 0)
  let state = { type: 0, stateId: 0, name: 'air', position: target }
  bot.blockAt = () => state
  const packets = []
  bot._client.write = (name, data) => packets.push({ name, ...data })
  require('../lib/plugins/generic_place')(bot)
  require('../lib/plugins/place_block')(bot)
  const place = () => bot.placeBlock({ position: target.offset(0, -1, 0) }, new Vec3(0, 1, 0))
  const correction = stateId => {
    const before = state
    state = { type: stateId, stateId, name: stateId ? 'cobblestone' : 'air', position: target }
    bot.emit(`blockUpdate:${target}`, before, state)
    bot._client.emit('block_change', { location: target, type: stateId })
  }
  const ack = sequenceId => bot._client.emit('acknowledge_player_digging', { sequenceId })
  const clean = () => {
    assert.equal(bot.listenerCount(`blockUpdate:${target}`), 0)
    for (const event of ['block_change', 'acknowledge_player_digging', 'end']) assert.equal(bot._client.listenerCount(event), 0)
  }
  return { bot, packets, place, correction, ack, clean, target, Item }
}
describe('placement acknowledgements', function () {
  this.timeout(15000)
  test('post-send unchanged correction and matching ack reject and release listeners', async () => {
    const f = fixture(); const result = f.place(); await turn()
    assert.equal(f.packets[0].sequence, 1)
    f.correction(0); f.ack(1)
    await assert.rejects(result, /processed placement.*still air/)
    f.clean()
  })
  test('stale ack does not reject; observed success emits blockPlaced', async () => {
    const f = fixture(); nextInteractionSequence(f.bot)
    let placed = 0; let settled = false
    f.bot.on('blockPlaced', () => placed++)
    const result = f.place(); result.finally(() => { settled = true }).catch(() => {})
    await turn(); f.correction(0); f.ack(1); await turn()
    assert.equal(settled, false)
    f.correction(14); await result
    assert.equal(placed, 1); f.clean()
  })
  test('pre-send updates during aim and ack without correction cannot reject', async () => {
    const f = fixture(); let finishAim
    f.bot.lookAt = () => new Promise(resolve => { finishAim = resolve })
    const result = f.place(); f.correction(0); f.ack(1)
    assert.equal(f.packets.length, 0)
    finishAim(); await turn()
    let settled = false; result.finally(() => { settled = true }).catch(() => {})
    f.ack(1); await turn(); assert.equal(settled, false)
    f.correction(0); await assert.rejects(result, /processed placement/); f.clean()
  })
  test('legacy ack and missing modern correction retain five-second fallback', async () => {
    for (const version of ['1.18.2', '1.21.4']) {
      const f = fixture(version); const result = f.place(); await turn()
      if (version === '1.18.2') {
        f.correction(0)
        f.bot._client.emit('acknowledge_player_digging', { location: f.target, block: 0, status: 0, successful: false })
        assert.equal(f.packets[0].sequence, undefined)
      } else f.ack(1)
      await assert.rejects(result, /did not fire within timeout of 5000ms/); f.clean()
    }
  })
  test('disconnect and send failure release observers', async () => {
    const f = fixture(); const result = f.place(); await turn(); f.bot._client.emit('end')
    await assert.rejects(result, /Connection ended/); f.clean()
    f.bot.lookAt = async () => { throw new Error('aim failed') }
    await assert.rejects(f.place(), /aim failed/); f.clean()
  })
  test('native item use, dig, activation, placement and boat use share send order', async () => {
    const f = fixture(); delete f.bot.heldItem; f.bot.QUICK_BAR_START = 36
    require('../lib/plugins/inventory')(f.bot, {})
    f.bot.quickBarSlot = 0
    f.bot.inventory.slots[36] = new f.Item(f.bot.registry.itemsByName.cobblestone.id, 2)
    require('../lib/plugins/digging')(f.bot)
    f.bot.digTime = () => 0
    f.bot._updateBlockState = (position, stateId) => f.correction(stateId)
    f.bot.activateItem(); f.bot.deactivateItem(); f.correction(14)
    await f.bot.dig(f.bot.blockAt(f.target), 'ignore')
    await f.bot.activateBlock({ position: f.target })
    await f.bot._genericPlace({ position: f.target }, new Vec3(0, 1, 0), {})
    require('../lib/plugins/place_entity')(f.bot)
    f.bot.inventory.slots[36] = new f.Item(f.bot.registry.itemsByName.oak_boat.id, 1)
    const write = f.bot._client.write
    f.bot._client.write = (name, data) => {
      write(name, data)
      if (name === 'use_item') queueMicrotask(() => f.bot.emit('entitySpawn', { name: 'boat', position: f.target.offset(0, 1, 0) }))
    }
    await f.bot.placeEntity({ position: f.target }, new Vec3(0, 1, 0))
    const sequences = f.packets.filter(packet => ['block_dig', 'block_place', 'use_item'].includes(packet.name)).map(packet => packet.sequence)
    assert.deepEqual(sequences, [1, 2, 3, 4, 5, 6, 7, 8])
  })

  test('disconnect during smooth aim releases observers and prevents a late placement', async () => {
    const f = fixture()
    let finishAim
    f.bot.lookAt = () => new Promise(resolve => { finishAim = resolve })
    const placing = f.place()
    await turn()
    f.bot._client.emit('end')
    await assert.rejects(placing, /Connection ended/)
    assert.equal(f.bot._client.listenerCount('block_change'), 0)
    assert.equal(f.bot._client.listenerCount('acknowledge_player_digging'), 0)
    assert.equal(f.bot.listenerCount(`blockUpdate:${f.target}`), 0)
    finishAim()
    await turn()
    assert.equal(f.packets.length, 0)
  })
})
