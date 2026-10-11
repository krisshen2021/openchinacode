import path from "path"

process.env.OPENCHINACODE_DB = ":memory:"
process.env.OPENCHINACODE_MODELS_PATH = path.join(import.meta.dir, "plugin", "fixtures", "models-dev.json")
process.env.OPENCHINACODE_DISABLE_MODELS_FETCH = "true"
