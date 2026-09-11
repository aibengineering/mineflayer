module.exports = inject

function inject (bot) {
  async function placeBlockWithOptions (referenceBlock, faceVector, options) {
    const dest = referenceBlock.position.plus(faceVector)
    let oldBlock = bot.blockAt(dest)
    let sent = false
    let sequence
    let correctedState
    let acknowledged = false
    let timer
    let ended = false
    let endPlacement
    const disconnected = new Promise(resolve => { endPlacement = resolve })
    let finish
    const observed = new Promise(resolve => { finish = resolve })
    const sequenced = bot.registry.version['>=']('1.19')
    const eventName = `blockUpdate:${dest}`

    function onBlockUpdate (before, after) {
      if (sent && (!before || !after || before.type !== after.type)) {
        finish({ kind: 'changed', before, after })
      }
    }

    function observeProcessed () {
      // An acknowledgement proves processing, not success. A post-send server
      // correction must also show the original state still at the destination.
      if (acknowledged && correctedState !== undefined && correctedState === oldBlock?.stateId &&
        bot.blockAt(dest)?.stateId === correctedState) {
        finish({ kind: 'unchanged', name: bot.blockAt(dest).name })
      }
    }

    function onCorrection (packet) {
      if (!sent || !dest.equals(packet.location)) return
      correctedState = packet.type
      observeProcessed()
    }

    function onAcknowledgement (packet) {
      if (sequence === undefined || !Number.isInteger(packet.sequenceId) || packet.sequenceId < sequence) return
      acknowledged = true
      observeProcessed()
    }

    function onEnd () {
      ended = true
      endPlacement()
      finish({ kind: 'ended' })
    }

    bot.on(eventName, onBlockUpdate)
    bot._client.on('end', onEnd)
    if (sequenced) {
      bot._client.on('block_change', onCorrection)
      bot._client.on('acknowledge_player_digging', onAcknowledgement)
    }
    try {
      await Promise.race([bot._genericPlace(referenceBlock, faceVector, {
        ...options,
        onSent (sentSequence) {
          if (ended) throw new Error('Connection ended while placing block')
          oldBlock = bot.blockAt(dest)
          sequence = sentSequence
          sent = true
        }
      }), disconnected.then(() => { throw new Error('Connection ended while placing block') })])
      const current = bot.blockAt(dest)
      if (oldBlock && current && oldBlock.type !== current.type) {
        finish({ kind: 'changed', before: oldBlock, after: current })
      }
      // Preserve the existing timeout when the protocol or server supplies no
      // conclusive correction/ack pair. It starts after the placement is sent.
      timer = setTimeout(() => finish({ kind: 'timeout' }), 5000)
      const result = await observed
      if (result.kind === 'unchanged') {
        throw new Error(`Server processed placement, but block at ${dest} is still ${result.name}`)
      }
      if (result.kind === 'ended') throw new Error('Connection ended while placing block')
      if (result.kind === 'timeout') throw new Error(`Event ${eventName} did not fire within timeout of 5000ms`)
      const { before, after } = result
      // blockUpdate emits (null, null) when the world unloads.
      if (!before && !after) return
      if (before?.type === after?.type) {
        throw new Error(`No block has been placed : the block is still ${before?.name}`)
      }
      bot.emit('blockPlaced', before, after)
    } finally {
      clearTimeout(timer)
      bot.removeListener(eventName, onBlockUpdate)
      bot._client.removeListener('end', onEnd)
      bot._client.removeListener('block_change', onCorrection)
      bot._client.removeListener('acknowledge_player_digging', onAcknowledgement)
    }
  }

  async function placeBlock (referenceBlock, faceVector) {
    await placeBlockWithOptions(referenceBlock, faceVector, { swingArm: 'right' })
  }

  bot.placeBlock = placeBlock
  bot._placeBlockWithOptions = placeBlockWithOptions
}
