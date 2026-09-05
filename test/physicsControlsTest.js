/* eslint-env mocha */

const assert = require('assert')
const { EventEmitter } = require('events')
const { Vec3 } = require('vec3')
const injectPhysics = require('../lib/plugins/physics')
const { testedVersions } = require('../lib/version')

function createBot (version) {
  const bot = new EventEmitter()
  bot.registry = require('prismarine-registry')(version)
  bot.supportFeature = bot.registry.supportFeature
  bot.version = version
  bot.entity = { id: 1, yaw: 0, pitch: 0, position: new Vec3(0, 64, 0), velocity: new Vec3(0, 0, 0) }
  bot.isAlive = true
  bot.blockAt = () => ({})
  bot._client = new EventEmitter()
  const packets = []
  bot._client.write = (name, data) => packets.push({ name, data })
  injectPhysics(bot, { physicsEnabled: false })
  return { bot, packets }
}

for (const version of testedVersions) {
  describe(`physics control packets ${version}v`, () => {
    it('sends both sneak transitions before an immediate interaction', () => {
      const { bot, packets } = createBot(version)
      for (const state of [true, false]) {
        packets.length = 0
        bot.setControlState('sneak', state)
        bot._client.write('interaction-marker', {})
        const actions = packets.filter(p => p.name === 'entity_action')
        if (bot.registry.version['<']('1.21.6')) {
          assert.deepStrictEqual(actions, [{ name: 'entity_action', data: { entityId: 1, actionId: state ? 0 : 1, jumpBoost: 0 } }])
          assert(packets.indexOf(actions[0]) < packets.length - 1)
        } else {
          // These action IDs became leave_bed/start_sprinting in 1.21.6.
          assert.deepStrictEqual(actions, [])
        }
        const inputs = packets.filter(p => p.name === 'player_input')
        assert.deepStrictEqual(inputs, bot.supportFeature('newPlayerInputPacket')
          ? [{ name: 'player_input', data: { inputs: { shift: state } } }]
          : [])
      }
    })
  })
}

for (const version of ['1.8.8', '1.21.4']) {
  describe(`physics look completion ${version}v`, () => {
    it('does not resolve a pitch-only look before that pitch is sent', async () => {
      const { bot, packets } = createBot(version)
      bot.emit('login')
      bot._client.emit('position', { x: 0, y: 64, z: 0, yaw: 180, pitch: 0, flags: 0, teleportId: 1 })
      try {
        await bot.look(0, Math.PI / 2)
        const lastRotation = packets.filter(p => p.name === 'look' || p.name === 'position_look').at(-1)
        assert(Math.abs(lastRotation.data.pitch + 90) < 0.1, `look resolved at pitch ${lastRotation.data.pitch}`)
      } finally {
        bot.emit('end')
      }
    })
  })
}
