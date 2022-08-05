const getStackFamily = require('./stack-family');
const getChangeSetFamily = require('./change-set-family');
const deltaArrow = require('./delta-arrow');
const deltaValue = require('./delta-value');

/**
 * Returns a multi-line string describing the parameters that have changed
 * @param {ParameterDeltas} deltas
 * @returns {String}
 */
function parameterDeltasList(deltas) {
  if (!deltas.length) {
    return 'This change set contained no meaningful parameter deltas.';
  }

  // Text blocks within attachments have a 3000 character limit. If the text is
  // too large, try creating the list without links to reduce the size.
  const withLinks = deltas
    .map((d) => {
      const oldValue = deltaValue(d.parameter, d.stackValue);
      const arrow = deltaArrow(d);
      const newValue = deltaValue(d.parameter, d.changeSetValue);

      return `*${d.stackName}::${d.parameter}*: ${oldValue} ${arrow} ${newValue}`;
    })
    .join('\n');

  if (withLinks.length < 2900) {
    return withLinks;
  } else {
    return deltas
      .map((d) => {
        const oldValue = deltaValue(d.parameter, d.stackValue, true);
        const arrow = deltaArrow(d, true);
        const newValue = deltaValue(d.parameter, d.changeSetValue, true);

        return `*${d.stackName}::${d.parameter}*: ${oldValue} ${arrow} ${newValue}`;
      })
      .join('\n');
  }
}

module.exports = {
  async nestedParameterDeltaText(stackName, changeSetName) {
    const stackFamily = await getStackFamily(stackName);
    const changeSetFamily = await getChangeSetFamily(stackName, changeSetName);

    /** @type {ParameterDeltas} */
    const deltas = [];

    // Iterate through all existing stack parameters and create a delta for
    // each one, which includes the current value.
    for (const stack of stackFamily) {
      for (const param of stack.Parameters || []) {
        deltas.push({
          stackName: stack.StackName,
          stackId: stack.StackId,
          parameter: param.ParameterKey,
          stackValue: param.ResolvedValue || param.ParameterValue,
          changeSetValue: null,
        });
      }
    }

    // Iterate through all the change set parameters. If a delta already exists
    // for a given stack+parameter key, add the value from the change set to
    // that delta. If not, make a new delta.
    for (const changeSet of changeSetFamily) {
      for (const param of changeSet.Parameters || []) {
        const delta = deltas.find(
          (d) =>
            param.ParameterKey === d.parameter &&
            changeSet.StackName === d.stackName,
        );

        if (delta) {
          delta.changeSetValue = param.ResolvedValue || param.ParameterValue;
        } else {
          deltas.push({
            stackName: changeSet.StackName,
            stackId: changeSet.StackId,
            parameter: param.ParameterKey,
            stackValue: null,
            changeSetValue: param.ResolvedValue || param.ParameterValue,
          });
        }
      }
    }

    // Filter down to only deltas where the values are different
    const changeDeltas = deltas.filter(
      (d) => d.stackValue !== d.changeSetValue,
    );

    // When using nested change sets, not all parameters in nested stacks are
    // correctly resolved. Any parameter values that depend on a stack or
    // resource output will be included in the change set parameters with an
    // unresolved value that looks like "{{IntrinsicFunction:…". Unless or until
    // AWS makes nested change sets smarter, we have to just ignore these,
    // because there's no way to compare the actual existing value from the stack
    // to the hypothetical future value that will be resolved when the change set
    // executes.
    //
    // Any parameters effected by this limitation are filtered out.
    const cleanedDeltas = changeDeltas.filter(
      (d) => !(d.changeSetValue || '').match(/\{\{IntrinsicFunction\:/),
    );

    const allowedDeltas = cleanedDeltas.filter(
      (d) =>
        !['PipelineExecutionNonce', 'TemplateUrlBase'].includes(d.parameter),
    );

    return parameterDeltasList(allowedDeltas);
  },
};
