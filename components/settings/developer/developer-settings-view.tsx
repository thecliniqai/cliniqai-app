"use client";

import React, { useState } from "react";
import { ApiKeyItem, createApiKey, revokeApiKey } from "@/features/api-keys/actions";
import {
  WebhookSubscriptionItem,
  WebhookDeliveryLogItem,
  createWebhookSubscription,
  deleteWebhookSubscription,
  testPingWebhook,
  listDeliveryLogs,
} from "@/features/webhooks/actions";
import { ApiKeyTable } from "./api-key-table";
import { CreateApiKeyModal } from "./create-api-key-modal";
import { SingleRevealKeyModal } from "./single-reveal-key-modal";
import { RevokeKeyModal } from "./revoke-key-modal";
import { WebhookSubscriptionList } from "./webhook-subscription-list";
import { CreateWebhookModal } from "./create-webhook-modal";
import { WebhookDeliveryLogsDrawer } from "./webhook-delivery-logs-drawer";
import { reportClientError } from "@/lib/log/client";

export interface DeveloperSettingsViewProps {
  initialKeys: ApiKeyItem[];
  initialSubscriptions: WebhookSubscriptionItem[];
}

export function DeveloperSettingsView({
  initialKeys,
  initialSubscriptions,
}: DeveloperSettingsViewProps) {
  // State: API Keys
  const [keys, setKeys] = useState<ApiKeyItem[]>(initialKeys);
  const [isCreateKeyOpen, setIsCreateKeyOpen] = useState(false);
  const [revealedKey, setRevealedKey] = useState<{
    name: string;
    prefix: string;
    rawKey: string;
  } | null>(null);
  const [revokingKey, setRevokingKey] = useState<ApiKeyItem | null>(null);
  const [isKeyActionLoading, setIsKeyActionLoading] = useState(false);

  // State: Webhooks
  const [subscriptions, setSubscriptions] = useState<WebhookSubscriptionItem[]>(initialSubscriptions);
  const [isCreateWebhookOpen, setIsCreateWebhookOpen] = useState(false);
  const [isWebhookActionLoading, setIsWebhookActionLoading] = useState(false);

  // State: Delivery Logs Drawer
  const [activeDrawerSub, setActiveDrawerSub] = useState<WebhookSubscriptionItem | null>(null);
  const [drawerLogs, setDrawerLogs] = useState<WebhookDeliveryLogItem[]>([]);
  const [isDrawerLoading, setIsDrawerLoading] = useState(false);

  // Handlers: API Keys
  const handleGenerateKey = async (name: string) => {
    setIsKeyActionLoading(true);
    try {
      const res = await createApiKey(name);
      if (!res.success || !res.key) {
        throw new Error(res.error || "Failed to create API key.");
      }

      setRevealedKey({
        name: res.key.name,
        prefix: res.key.prefix,
        rawKey: res.key.rawKey,
      });

      // Add to local key list
      setKeys((prev) => [
        {
          id: res.key!.id,
          name: res.key!.name,
          keyPrefix: res.key!.prefix,
          scope: "Clinic Admin",
          createdAt: new Date().toISOString(),
          lastUsedAt: null,
          revokedAt: null,
          todayRequestCount: 0,
        },
        ...prev,
      ]);

      setIsCreateKeyOpen(false);
    } finally {
      setIsKeyActionLoading(false);
    }
  };

  const handleConfirmRevokeKey = async (keyId: string) => {
    setIsKeyActionLoading(true);
    try {
      const res = await revokeApiKey(keyId);
      if (!res.success) {
        throw new Error(res.error || "Failed to revoke API key.");
      }

      setKeys((prev) =>
        prev.map((k) =>
          k.id === keyId ? { ...k, revokedAt: new Date().toISOString() } : k
        )
      );
      setRevokingKey(null);
    } finally {
      setIsKeyActionLoading(false);
    }
  };

  // Handlers: Webhooks
  const handleSaveWebhook = async (data: { endpointUrl: string; eventTypes: string[] }) => {
    setIsWebhookActionLoading(true);
    try {
      const res = await createWebhookSubscription(data);
      if (!res.success || !res.subscription) {
        throw new Error(res.error || "Failed to save webhook subscription.");
      }

      setSubscriptions((prev) => [res.subscription!, ...prev]);
      setIsCreateWebhookOpen(false);
    } finally {
      setIsWebhookActionLoading(false);
    }
  };

  const handleDeleteWebhook = async (sub: WebhookSubscriptionItem) => {
    if (!window.confirm(`Are you sure you want to delete webhook endpoint "${sub.endpointUrl}"?`)) {
      return;
    }

    try {
      const res = await deleteWebhookSubscription(sub.id);
      if (res.success) {
        setSubscriptions((prev) => prev.filter((s) => s.id !== sub.id));
      }
    } catch (err) {
      reportClientError("webhooks.subscription_delete.failed", err);
    }
  };

  const handleOpenLogsDrawer = async (sub: WebhookSubscriptionItem) => {
    setActiveDrawerSub(sub);
    setIsDrawerLoading(true);
    try {
      const res = await listDeliveryLogs(sub.id);
      if (res.success) {
        setDrawerLogs(res.logs);
      }
    } finally {
      setIsDrawerLoading(false);
    }
  };

  const handleTestPing = async (subId: string) => {
    return await testPingWebhook(subId);
  };

  return (
    <div className="space-y-8">
      {/* Page Header (06-UI-SPEC.md §1.1) */}
      <div>
        <h1 className="text-2xl sm:text-3xl font-semibold text-gray-900 tracking-tight">
          Developer Settings
        </h1>
        <p className="text-sm text-gray-500 mt-1.5 leading-relaxed">
          Manage tenant-scoped API keys, outgoing webhook subscriptions, and external developer integrations.
        </p>
      </div>

      {/* Primary Section 1: REST API Keys */}
      <ApiKeyTable
        keys={keys}
        onCreateKey={() => setIsCreateKeyOpen(true)}
        onRevokeKey={(key) => setRevokingKey(key)}
      />

      {/* Secondary Section 2: Webhook Subscriptions (32px section rhythm) */}
      <WebhookSubscriptionList
        subscriptions={subscriptions}
        onAddEndpoint={() => setIsCreateWebhookOpen(true)}
        onDeleteSubscription={handleDeleteWebhook}
        onViewLogs={handleOpenLogsDrawer}
        onTestPing={handleTestPing}
      />

      {/* Modal 1: Create Key Input Dialog */}
      <CreateApiKeyModal
        isOpen={isCreateKeyOpen}
        onClose={() => setIsCreateKeyOpen(false)}
        onSubmit={handleGenerateKey}
        isLoading={isKeyActionLoading}
      />

      {/* Modal 2: Single-Reveal Key State */}
      <SingleRevealKeyModal
        isOpen={Boolean(revealedKey)}
        onClose={() => setRevealedKey(null)}
        keyDetails={revealedKey}
      />

      {/* Modal 3: Key Revocation Confirmation */}
      <RevokeKeyModal
        isOpen={Boolean(revokingKey)}
        onClose={() => setRevokingKey(null)}
        onConfirm={handleConfirmRevokeKey}
        apiKey={revokingKey}
        isLoading={isKeyActionLoading}
      />

      {/* Modal 4: Add Webhook Endpoint */}
      <CreateWebhookModal
        isOpen={isCreateWebhookOpen}
        onClose={() => setIsCreateWebhookOpen(false)}
        onSubmit={handleSaveWebhook}
        isLoading={isWebhookActionLoading}
      />

      {/* Drawer 1: Webhook Delivery Logs Slide-Over (480px) */}
      <WebhookDeliveryLogsDrawer
        open={Boolean(activeDrawerSub)}
        onClose={() => setActiveDrawerSub(null)}
        subscription={activeDrawerSub}
        logs={drawerLogs}
        isLoading={isDrawerLoading}
      />
    </div>
  );
}
