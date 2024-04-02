/**
 * @param {'GreaterThanOrEqualToThreshold'|'GreaterThanThreshold'|'LessThanThreshold'|'LessThanOrEqualToThreshold'|String} operator
 */
export function comparison(operator) {
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
}

/**
 * @param {'GreaterThanOrEqualToThreshold'|'GreaterThanThreshold'|'LessThanThreshold'|'LessThanOrEqualToThreshold'|String} operator
 */
export function ascii(operator) {
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
}
