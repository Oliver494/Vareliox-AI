export type ProjectInfo = {
  name: string;
  path: string;
};

export type FileNode = {
  name: string;
  path: string;
  relativePath: string;
  isDirectory: boolean;
  children: FileNode[];
};

export type OpenFile = {
  name: string;
  path: string;
  relativePath: string;
  content: string;
  savedContent: string;
};

export type Notice = {
  id: number;
  tone: "success" | "error" | "info";
  message: string;
};

export type ProviderId = "ollama" | "lm_studio" | "open_ai" | "anthropic" | "gemini" | "nvidia" | "zai" | "kimi" | "custom";
export type InstalledLocalModel = { id: string; name: string; runtime: "vareliox" | "ollama" | "lm_studio" };
export type ReasoningEffort = "low" | "medium" | "high";
export type ModelCapability = "chat" | "image" | "video" | "vision" | "code";
export type ProviderModels = { chat: string; image: string; video: string };
export type MediaVerification = { endpoint: string; imageModel: string };

export type ProviderConfig = {
  configId: string;
  provider: ProviderId;
  displayName: string;
  logoDataUrl: string | null;
  endpoint: string;
  /** Legacy transport alias. New UI reads and writes models.chat. */
  model: string;
  models: ProviderModels;
  capabilities: ModelCapability[];
  /** A successful explicit generation test for this exact custom endpoint and image model. */
  mediaVerification?: MediaVerification | null;
  reasoningEffort: ReasoningEffort;
  connectTimeoutSecs: number;
  firstResponseTimeoutSecs: number;
  inactivityTimeoutSecs: number;
  maxResponseTimeoutSecs: number;
  apiKeyConfigured: boolean;
};

export type AiSettings = {
  activeProvider: ProviderId | null;
  activeConfigId: string | null;
  providers: ProviderConfig[];
};

export type ModelInfo = {
  id: string;
  name: string;
  loaded: boolean | null;
  contextWindow: number | null;
  capabilities: ModelCapability[];
};

export type LocalModelCatalogItem = {
  id: string;
  name: string;
  family: string;
  description: string;
  parameters: string;
  size: string;
  ollamaId: string;
  lmStudioId: string;
  recommended: boolean;
  category: "chat" | "code" | "vision" | "image" | "video";
  capabilities: string[];
  runtimes: string[];
  guideUrl: string | null;
};

export type LocalModelDownloadEvent =
  | { type: "status"; message: string; progress: number | null }
  | { type: "done"; modelId: string }
  | { type: "error"; diagnostic: Diagnostic };

export type Diagnostic = {
  code: string;
  title: string;
  explanation: string;
  cause: string;
  action: string;
  technicalDetails: string | null;
  retryable: boolean;
};

export type ProviderTestResult = {
  connected: boolean;
  durationMs: number;
  models: ModelInfo[];
  diagnostic: Diagnostic | null;
};

export type ChatUpload = {
  id: string;
  name: string;
  path: string;
  mimeType: string;
  kind: "image" | "text";
  data: string;
  size: number;
};

export type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  reasoning?: string;
  createdAt: number;
  uploads?: Omit<ChatUpload, "data">[];
  contextReferences?: ContextReference[];
  appliedChanges?: AppliedChange[];
  recoverySnapshotId?: string;
  generatedMedia?: MediaGenerationResult;
  webSearchAttempted?: boolean;
  webSearchError?: string;
  webSources?: WebSearchSource[];
};

export type WebSearchSource = { title: string; url: string; snippet: string };
export type WebSearchResult = { query: string; sources: WebSearchSource[] };

export type ContextReference = { path: string; startLine: number; endLine: number; truncated: boolean };
export type AppliedChange = { type: "write" | "mkdir" | "rename" | "delete"; path: string; newPath?: string; before?: string; after?: string; truncated?: boolean };
export type ExternalFolderGrant = { id: string; path: string; name: string; access: "read" | "write" };
export type ComputerRoot = { id: string; path: string; name: string };

export type Conversation = {
  id: string;
  title: string;
  customTitle: boolean;
  projectPath: string | null;
  pinned: boolean;
  pinnedOrder: number | null;
  archived: boolean;
  archivedAt: number | null;
  lastError?: boolean;
  assistantMode: ConversationMode;
  approvalMode: "ask" | "auto" | "full";
  externalFolders: ExternalFolderGrant[];
  agentTask?: AgentTask;
  compactedContext?: string;
  compactedAt?: number;
  messages: ChatMessage[];
  createdAt: number;
  updatedAt: number;
};

export type ConversationMode = "chat" | "code";
export type AssistantWorkspace = ConversationMode;

export type MediaMode = "image" | "video";
export type MediaGenerationResult = {
  id: string;
  mediaType: MediaMode;
  dataUrl: string;
  uri: string | null;
  mimeType: string;
  provider: ProviderId;
  model: string;
  width: number | null;
  height: number | null;
  durationMs: number | null;
  seed: number | null;
  elapsedMs?: number;
};
export type MediaStorageStats = { files: number; bytes: number };

export type AgentState = "idle" | "analyzing" | "planning" | "awaiting_approval" | "executing" | "testing" | "correcting" | "completed" | "cancelled" | "failed" | "interrupted";
export type AgentStep = { id: string; label: string; status: "pending" | "in_progress" | "completed" | "failed"; detail?: string };
export type AgentTask = { id: string; state: AgentState; startedAt: number; updatedAt: number; steps: AgentStep[]; ownerMessageId?: string; command?: string; output?: string; exitCode?: number | null; durationMs?: number; truncated?: boolean };
export type AgentToolSpec = { id: string; description: string; risk: "low" | "medium" | "high"; permission: "read" | "write" | "execute" | "destructive"; timeoutSecs: number; cancellable: boolean };
export type DetectedCommand = { id: string; label: string; program: string; args: string[]; kind: "test" | "build" | "check" };
export type AgentCommandEvent =
  | { type: "started"; command: string }
  | { type: "output"; stream: "stdout" | "stderr"; text: string }
  | { type: "finished"; exitCode: number | null; durationMs: number; truncated: boolean }
  | { type: "cancelled" }
  | { type: "error"; code: string; title: string; explanation: string; action: string };

export type AiFileChange = { path: string; content: string };
export type AiProjectAction = {
  type: "write" | "mkdir" | "rename" | "delete";
  path: string;
  content?: string;
  newPath?: string;
  rootId?: string;
};

export type AiTerminalAction = {
  command?: string;
  program?: string;
  args?: string[];
  cwd?: string;
  rootId?: string;
  purpose?: string;
};

export type RecoverySnapshotInfo = {
  id: string;
  createdAt: number;
  actionCount: number;
  summary: string[];
};

export type AiChatEvent =
  | { type: "status"; message: string; elapsedMs: number }
  | { type: "reasoning"; text: string }
  | { type: "delta"; text: string }
  | { type: "done"; elapsedMs: number }
  | { type: "cancelled" }
  | { type: "error"; diagnostic: Diagnostic };
