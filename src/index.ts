// Definitions and implementations
export { defineTool, toJSONSchema } from "./define.js";
export type {
  AnyToolDefinition,
  InferHandlerInput,
  InferHandlerOutput,
  InferToolInput,
  InferToolOutput,
  NoArguments,
  ToolAnnotations,
  ToolDefinition,
  ToolDefinitionArg,
  ToolDefinitionInit,
  ToolMetadataInit,
} from "./define.js";
export { implementTool, runTool } from "./implement.js";
export type { AnyToolImplementation, ToolCallContext, ToolHandler, ToolImplementation, ToolRunResult } from "./implement.js";

// Schemas
export { withJsonSchema } from "./schema.js";
export type {
  AnyInputSchema,
  AnyOutputSchema,
  InferSchemaInput,
  InferSchemaOutput,
  JSONSchema,
  JSONSchemaResolution,
  JsonValue,
  StandardJSONSchemaV1,
  StandardSchemaV1,
  ToolSchema,
} from "./schema.js";

// Errors
export { isToolError, isToolFailureEnvelope, ToolError, WebMCPError } from "./errors.js";
export type { ToolErrorOptions, ToolFailure, ToolFailureEnvelope, ToolFailureKind, ToolIssue, WebMCPErrorCode } from "./errors.js";

// Publishing
export { registerTools } from "./register.js";
export type {
  RegisterToolsOptions,
  UnexpectedErrorInfo,
  ToolRegistration,
  ToolRegistrationEntry,
  ToolRegistrationSnapshot,
  ToolRegistrationState,
  UniqueToolNames,
} from "./register.js";

// Discovering (experimental)
export { createToolCatalog, toProviderName } from "./catalog.js";
export type {
  DiscoveredTool,
  KnownTool,
  ToolCallError,
  ToolCallResult,
  ToolCatalog,
  ToolCatalogOptions,
  ToolCatalogSnapshot,
  ToolSource,
} from "./catalog.js";

// Platform shapes
export type { ModelContextConsumerLike, ModelContextLike, ModelContextTool, RegisteredTool } from "./model-context.js";

export { NotImplementedError } from "./not-implemented.js";
