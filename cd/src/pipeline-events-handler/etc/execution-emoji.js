// These should be easily identifiable and both visually and conceptually unique
// Don't include symbols that could be misconstrued to have some actual meaning
// (like a warning sign)
const emojis =
  '🦊🐸🦉🦄🐙🐳🌵🍀🍁🍄🌍⭐️🔥🌈🍎🥯🌽🥞🥨🍕🌮🍦🎂🍿🏈🛼🏆🎧🎺🎲🚚✈️🚀⛵️⛺️📻💰💎🧲🔭🪣🧸';

module.exports = {
  emoji(executionId) {
    // Create a simple hash of the execution ID
    const hash = [...executionId].reduce(
      (prev, curr) => prev + curr.charCodeAt(0),
      0,
    );

    // Return an emoji based on the hash. This is hopefully significantly
    // random that deploys near to each other in time don't get the same
    // symbol
    return [...emojis][hash % [...emojis].length];
  },
};
