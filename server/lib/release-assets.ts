// Files the API generates for every release, kept in one place so all routes agree.
// The provider-file split builder is the same file the Python client ships
// (sdk/python/src/owl_wireless/split_builder.py), so the two can never drift.
import buildScript from "../../sdk/python/src/owl_wireless/split_builder.py?raw";

import type { ReleaseAssets } from "./releases";

export const releaseAssets: ReleaseAssets = { buildScript };
