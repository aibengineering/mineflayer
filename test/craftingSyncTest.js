const assert = require('node:assert/strict')
const { EventEmitter } = require('node:events')
const { it: test } = require('mocha')
const turn = () => new Promise(resolve => setImmediate(resolve))
function fixture () {
  const bot = new EventEmitter()
  bot._client = new EventEmitter()
  bot.version = '1.21.4'
  bot.registry = require('prismarine-registry')(bot.version)
  bot.supportFeature = bot.registry.supportFeature
  bot.entity = { id: 1 }
  bot.QUICK_BAR_START = 36
  const packets = []
  bot._client.write = (name, data) => packets.push({ name, ...data })
  require('../lib/plugins/inventory')(bot, {})
  const Item = require('prismarine-item')(bot.registry)
  const item = (name, count = 1) => new Item(bot.registry.itemsByName[name].id, count)
  const slot = (index, value, stateId = 1, windowId = 0) => bot._client.emit('set_slot', { windowId, stateId, slot: index, item: Item.toNotch(value) })
  const full = (stateId, carried = null) => bot._client.emit('window_items', { windowId: 0, stateId, items: bot.inventory.slots.map(Item.toNotch), carriedItem: Item.toNotch(carried) })
  return { bot, packets, item, slot, full, Item }
}
test('result pickup predicts consumed inputs before send and waits for every server grid result update', async () => {
  const f = fixture()
  f.slot(0, f.item('ender_eye'), 7)
  f.slot(3, f.item('blaze_powder'), 7)
  f.slot(4, f.item('ender_pearl'), 7)
  let settled = false
  const take = f.bot._takeCraftingResult([1, 2, 3, 4].map(slot => ({ slot, item: null })), 2)
  take.then(() => { settled = true })
  assert.deepEqual(f.packets[0].changedSlots.map(change => change.location), [0, 1, 2, 3, 4])
  assert.equal(f.packets[0].cursorItem.itemId, f.item('ender_eye').type)
  f.bot.inventory.emit('updateSlot:0', null, null)
  f.full(8)
  f.slot(0, null, 9, 2)
  await turn()
  assert.equal(settled, false)
  f.slot(0, null, 9)
  await turn()
  assert.equal(settled, false)
  f.slot(0, null, 9) // Duplicate state is not another grid mutation.
  await turn()
  assert.equal(settled, false)
  f.slot(0, null, 10)
  await take
  assert.equal(f.bot._client.listenerCount('end'), 0)
  assert.equal(f.bot.listenerCount('windowClose'), 0)
})
test('authoritative cursor and per-window state survive other-window updates', async () => {
  const f = fixture()
  f.full(12, f.item('ender_pearl', 3))
  assert.equal(f.bot.inventory.selectedItem.count, 3)
  f.slot(0, null, 75, 2)
  await f.bot.clickWindow(9, 0, 0)
  assert.equal(f.packets[0].stateId, 12)
  assert.equal(f.packets[0].changedSlots[0].item.itemCount, 3)
})
for (const ending of ['disconnect', 'close', 'write failure']) {
  test(`result observation cleans up on ${ending}`, async () => {
    const f = fixture()
    f.slot(0, f.item('blaze_powder', 2))
    if (ending === 'write failure') f.bot._client.write = () => { throw new Error('write failed') }
    const pending = f.bot._takeCraftingResult([{ slot: 4, item: null }], 1)
    if (ending === 'disconnect') f.bot._client.emit('end')
    if (ending === 'close') f.bot.closeWindow(f.bot.inventory)
    await assert.rejects(pending)
    assert.equal(f.bot._client.listenerCount('end'), 0)
    assert.equal(f.bot.listenerCount('windowClose'), 0)
  })
}
test('result listener is armed before send and accepts state-id wrap', async () => {
  const f = fixture()
  f.slot(0, f.item('blaze_powder', 2), 32767)
  f.bot._client.write = () => f.slot(0, null, 0)
  await f.bot._takeCraftingResult([{ slot: 4, item: null }], 1)
})

test('clicking an empty crafting result remains an immediate no-op', async () => {
  const f = fixture()
  await f.bot.clickWindow(0, 0, 0)
  assert.equal(f.packets.length, 1)
  assert.equal(f.bot._client.listenerCount('end'), 0)
})

test('taking a whole grid remainder waits for remove and empty-slot updates', async () => {
  const f = fixture()
  f.slot(1, f.item('glass_bottle'), 5)
  let settled = false
  const pending = f.bot.clickWindow(1, 0, 0)
  pending.then(() => { settled = true })
  f.slot(0, null, 6)
  await turn()
  assert.equal(settled, false)
  f.slot(0, null, 7)
  await pending
})

test('public result click with an incompatible cursor does not acquire a result waiter', async () => {
  const f = fixture()
  f.slot(0, f.item('blaze_powder', 2))
  f.bot.inventory.selectedItem = f.item('stone')
  await f.bot.clickWindow(0, 0, 0)
  assert.equal(f.bot._client.listenerCount('end'), 0)
})
