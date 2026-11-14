"use client";

import React from "react";
import { Key, Plus, Trash2 } from "lucide-react";
import { Table, TableBody, TableCell, TableContainer, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { ApiKeyItem } from "@/features/api-keys/actions";

export interface ApiKeyTableProps {
  keys: ApiKeyItem[];
  onCreateKey: () => void;
  onRevokeKey: (key: ApiKeyItem) => void;
  isLoading?: boolean;
}

function formatDate(isoString: string): string {
  try {
    return new Date(isoString).toLocaleDateString("en-IN", {
      day: "2-digit",
      month: "short",
      year: "numeric",
    });
  } catch {
    return isoString;
  }
}

function formatRelativeTime(isoString: string | null): string {
  if (!isoString) return "Never";
  try {
    const diffMs = Date.now() - new Date(isoString).getTime();
    const diffMins = Math.floor(diffMs / 60000);
    if (diffMins < 1) return "Just now";
    if (diffMins < 60) return `${diffMins}m ago`;
    const diffHours = Math.floor(diffMins / 60);
    if (diffHours < 24) return `${diffHours}h ago`;
    const diffDays = Math.floor(diffHours / 24);
    return `${diffDays}d ago`;
  } catch {
    return "Never";
  }
}

export function ApiKeyTable({
  keys,
  onCreateKey,
  onRevokeKey,
  isLoading = false,
}: ApiKeyTableProps) {
  const activeKeys = keys.filter((k) => !k.revokedAt);
  const revokedKeys = keys.filter((k) => Boolean(k.revokedAt));
  const allKeys = [...activeKeys, ...revokedKeys];

  return (
    <div className="rounded-xl border border-border bg-white shadow-theme-xs overflow-hidden">
      {/* Card Header (Primary Visual Anchor per 06-UI-SPEC.md §1.1) */}
      <div className="p-6 border-b border-border flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-accent-subtle text-accent flex items-center justify-center shrink-0">
              <Key className="w-4 h-4" />
            </div>
            <h2 className="text-xl font-semibold text-gray-900 tracking-tight">
              REST API Keys
            </h2>
          </div>
          <p className="text-sm text-gray-500 mt-1">
            Authenticate external clients and backend integrations using Bearer tokens.
          </p>
        </div>

        <Button
          onClick={onCreateKey}
          variant="primary"
          size="md"
          className="shrink-0 font-medium"
          startIcon={<Plus className="w-4 h-4" />}
        >
          Create New API Key
        </Button>
      </div>

      {/* Content */}
      {allKeys.length === 0 ? (
        <EmptyState
          icon={<Key className="w-6 h-6 text-fg-subtle" />}
          title="No API Keys Created"
          description="Generate a tenant-scoped API key to integrate external clients, EHRs, or the AI voice agent with ClinicQ."
          action={
            <Button
              onClick={onCreateKey}
              variant="primary"
              size="md"
              startIcon={<Plus className="w-4 h-4" />}
            >
              Create New API Key
            </Button>
          }
        />
      ) : (
        <TableContainer className="rounded-none border-0 shadow-none">
          <Table>
            <TableHeader className="bg-sunken/60">
              <TableRow>
                <TableHead className="text-xs font-semibold text-gray-600">Name</TableHead>
                <TableHead className="text-xs font-semibold text-gray-600">Key Prefix</TableHead>
                <TableHead className="text-xs font-semibold text-gray-600">Scope</TableHead>
                <TableHead className="text-xs font-semibold text-gray-600">Created</TableHead>
                <TableHead className="text-xs font-semibold text-gray-600">Last Used</TableHead>
                <TableHead className="text-xs font-semibold text-gray-600">Requests Today</TableHead>
                <TableHead className="text-xs font-semibold text-gray-600">Status</TableHead>
                <TableHead className="text-xs font-semibold text-gray-600 text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {allKeys.map((key) => {
                const isRevoked = Boolean(key.revokedAt);
                return (
                  <TableRow
                    key={key.id}
                    className={isRevoked ? "opacity-60 bg-gray-50/50" : undefined}
                  >
                    <TableCell className="font-semibold text-sm text-gray-900">
                      {key.name}
                    </TableCell>

                    <TableCell>
                      <span className="font-mono text-xs font-semibold px-2 py-0.5 rounded bg-accent-subtle text-accent border border-accent-border tabular-nums inline-block">
                        {key.keyPrefix}••••
                      </span>
                    </TableCell>

                    <TableCell>
                      <Badge color="primary" size="sm">
                        {key.scope}
                      </Badge>
                    </TableCell>

                    <TableCell className="text-sm text-gray-600 tabular-nums">
                      {formatDate(key.createdAt)}
                    </TableCell>

                    <TableCell className="text-sm text-gray-600 tabular-nums">
                      {formatRelativeTime(key.lastUsedAt)}
                    </TableCell>

                    <TableCell className="text-sm text-gray-700 font-medium tabular-nums">
                      {key.todayRequestCount.toLocaleString()} reqs
                    </TableCell>

                    <TableCell>
                      {isRevoked ? (
                        <Badge color="error" size="sm">
                          Revoked
                        </Badge>
                      ) : (
                        <Badge color="success" size="sm">
                          Active
                        </Badge>
                      )}
                    </TableCell>

                    <TableCell className="text-right">
                      {!isRevoked ? (
                        <button
                          onClick={() => onRevokeKey(key)}
                          className="inline-flex items-center gap-1.5 text-xs font-medium text-danger-fg hover:bg-rose-50 px-3 py-1.5 rounded-lg transition-colors cursor-pointer"
                          aria-label={`Revoke API key ${key.name}`}
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                          <span>Revoke Key</span>
                        </button>
                      ) : (
                        <span className="text-xs text-fg-subtle italic">Revoked</span>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </TableContainer>
      )}
    </div>
  );
}
