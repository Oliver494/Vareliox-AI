import { invoke } from "@tauri-apps/api/core";

export type ModelFit = { size: string; rating: "excellent" | "acceptable" | "not_recommended"; requiredRamGb: number; requiredVramGb: number };
export type VolumeInfo = { name: string; mountPoint: string; fileSystem: string; kind: string; totalBytes: number; availableBytes: number; removable: boolean; readOnly: boolean };
export type PhysicalDiskInfo = { model: string; mediaType: string; busType: string; sizeBytes: number | null; health: string | null; operationalStatus: string | null; firmware: string | null };
export type HardwareInfo = { cpu: string; physicalCores: number; logicalCores: number; ramBytes: number; availableRamBytes: number; diskTotalBytes: number | null; diskAvailableBytes: number | null; volumes: VolumeInfo[]; physicalDisks: PhysicalDiskInfo[]; gpu: string | null; vramBytes: number | null; recommendations: ModelFit[] };
export type GitStatus = { installed: boolean; repository: boolean; branch: string | null; changes: string[]; diagnostic: string | null };

export const localSystem = {
  hardware: (root: string | null) => invoke<HardwareInfo>("inspect_hardware", { root }),
  gitStatus: (root: string) => invoke<GitStatus>("git_status", { root }),
  gitDiff: (root: string) => invoke<string>("git_diff", { root }),
  gitCommit: (root: string, message: string) => invoke<string>("git_commit", { root, message }),
  gitDiscardChanges: (root: string) => invoke<string[]>("git_discard_changes", { root }),
};
