module.exports = async (event) => {
  if (['Staging', 'Production'].includes(event.detail.stage)) {
  }
};
