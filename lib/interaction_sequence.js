// Prediction acknowledgements share one sequence across all interactions on a connection.
const sequences = new WeakMap()

function nextInteractionSequence (bot) {
  if (!bot.registry.version['>=']('1.19')) return undefined
  const sequence = (sequences.get(bot) ?? 0) + 1
  sequences.set(bot, sequence)
  return sequence
}

module.exports = { nextInteractionSequence }
