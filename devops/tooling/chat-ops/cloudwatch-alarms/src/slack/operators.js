module.exports = {
  /**
   * @param {'GreaterThanOrEqualToThreshold'|'GreaterThanThreshold'|'LessThanThreshold'|'LessThanOrEqualToThreshold'|String} operator
   */
  comparison(operator) {
    switch (operator) {
      case 'GreaterThanOrEqualToThreshold':
        return '≥';
      case 'GreaterThanThreshold':
        return '>';
      case 'LessThanThreshold':
        return '<';
      case 'LessThanOrEqualToThreshold':
        return '≤';
      default:
        return '???';
    }
  },
  /**
   * @param {'GreaterThanOrEqualToThreshold'|'GreaterThanThreshold'|'LessThanThreshold'|'LessThanOrEqualToThreshold'|String} operator
   */
  ascii(operator) {
    switch (operator) {
      case 'GreaterThanOrEqualToThreshold':
        return '>=';
      case 'GreaterThanThreshold':
        return '>';
      case 'LessThanThreshold':
        return '<';
      case 'LessThanOrEqualToThreshold':
        return '<=';
      default:
        return '???';
    }
  },
};
