// Fail early if either side of the compatibility matrix resolves incorrectly.
import { version as reactVersion } from 'react';
import { version as rendererVersion } from 'react-dom';
if (reactVersion !== '18.3.1' || rendererVersion !== '18.3.1') {
  throw new Error(`Expected React/React DOM 18.3.1, got ${reactVersion}/${rendererVersion}`);
}
