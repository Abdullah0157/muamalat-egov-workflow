import { EnvironmentProviders, makeEnvironmentProviders } from '@angular/core';

import { DataGateway } from './data-gateway';
import { MockDataGateway } from './mock-data.gateway';

/**
 * The one file to change when the real API arrives.
 *
 * Point `DataGateway` at an `HttpDataGateway` here and nothing else in the
 * application moves: every screen, guard and resource already depends on the
 * abstract class rather than on the implementation.
 */
export function provideData(): EnvironmentProviders {
  return makeEnvironmentProviders([{ provide: DataGateway, useClass: MockDataGateway }]);
}
