'use client';

import { useState, useEffect } from 'react';
import { useAuth } from '@/lib/auth-context';
import { organizations, knowledgeGraph, type KgSettings } from '@/lib/api';
import * as Dialog from '@radix-ui/react-dialog';

export default function OrganizationSettingsPage() {
  const { token, user, orgName, orgs, setOrgName, switchOrg, replaceSession } = useAuth();
  const [name, setName] = useState('');
  const [orgId, setOrgId] = useState('');
  const [createdAt, setCreatedAt] = useState('');
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');

  // Create new org
  const [newOrgName, setNewOrgName] = useState('');
  const [creating, setCreating] = useState(false);
  const [createMessage, setCreateMessage] = useState('');

  // Delete organization
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteConfirmName, setDeleteConfirmName] = useState('');
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  // Knowledge graph feature toggles
  const [kg, setKg] = useState<KgSettings | null>(null);
  const [kgSaving, setKgSaving] = useState(false);

  const isAdmin = user?.role === 'ADMIN';

  useEffect(() => {
    if (!token) return;
    organizations.getCurrent(token).then((org) => {
      setName(org.name);
      setOrgId(org.id);
      setCreatedAt(org.createdAt);
    }).catch(() => {});
    knowledgeGraph.getSettings(token).then(setKg).catch(() => {});
  }, [token]);

  const updateFlag = async (patch: { enabled?: boolean; llmEnabled?: boolean; captureIntent?: boolean; autoExtend?: boolean; skillAutoApply?: boolean }) => {
    if (!token || !kg) return;
    setKgSaving(true);
    try {
      setKg(await knowledgeGraph.updateSettings(token, patch));
    } catch {
      /* keep previous state */
    } finally {
      setKgSaving(false);
    }
  };

  const handleSave = async () => {
    if (!token || !name.trim()) return;
    setSaving(true);
    setMessage('');
    try {
      const updated = await organizations.updateCurrent({ name: name.trim() }, token);
      setName(updated.name);
      setOrgName(updated.name);
      setMessage('Organization updated successfully');
    } catch (err: any) {
      setMessage(err.message || 'Failed to update organization');
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteOrg = async () => {
    if (!token) return;
    if (deleteConfirmName.trim() !== name.trim()) return;
    setDeleting(true);
    setDeleteError(null);
    try {
      const result = await organizations.deleteCurrent({ confirmName: deleteConfirmName.trim() }, token);
      replaceSession(result.accessToken, result.user, result.organization?.name ?? null);
      window.location.href = '/';
    } catch (err: any) {
      setDeleteError(err?.message || 'Failed to delete organization');
      setDeleting(false);
    }
  };

  const resetDeleteOrgDialog = () => {
    setDeleteOpen(false);
    setDeleteConfirmName('');
    setDeleteError(null);
    setDeleting(false);
  };

  const handleCreateOrg = async () => {
    if (!token || !newOrgName.trim()) return;
    setCreating(true);
    setCreateMessage('');
    try {
      const newOrg = await organizations.create(newOrgName.trim(), token);
      setCreateMessage('Organization created! Switching...');
      setNewOrgName('');
      await switchOrg(newOrg.id);
    } catch (err: any) {
      setCreateMessage(err.message || 'Failed to create organization');
      setCreating(false);
    }
  };

  return (
    <div className="space-y-6 max-w-2xl">
      <div>
        <h2 className="text-lg font-semibold">Organization</h2>
        <p className="text-sm text-[var(--muted-foreground)]">
          {isAdmin
            ? 'Manage your workspace settings. All members of this organization share connectors, MCP servers, and tools.'
            : 'View your current organization and create new workspaces.'}
        </p>
      </div>

      {/* Current organization — editable only for ADMIN */}
      <div className="bg-[var(--card)] border border-[var(--border)] rounded-lg p-5 space-y-4">
        <div>
          <label className="block text-sm font-medium mb-1">Organization Name</label>
          {isAdmin ? (
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full px-3 py-2 bg-[var(--background)] border border-[var(--border)] rounded-lg text-sm focus:ring-2 focus:ring-[var(--brand)] focus:border-transparent outline-none"
              placeholder="My Workspace"
            />
          ) : (
            <p className="px-3 py-2 bg-[var(--accent)] border border-[var(--border)] rounded-lg text-sm text-[var(--muted-foreground)]">
              {name}
            </p>
          )}
        </div>

        <div>
          <label className="block text-sm font-medium mb-1">Organization ID</label>
          <input
            type="text"
            value={orgId}
            readOnly
            className="w-full px-3 py-2 bg-[var(--accent)] border border-[var(--border)] rounded-lg text-sm text-[var(--muted-foreground)] cursor-not-allowed"
          />
        </div>

        <div>
          <label className="block text-sm font-medium mb-1">Your Role</label>
          <p className="text-sm text-[var(--muted-foreground)]">{user?.role}</p>
        </div>

        {createdAt && (
          <div>
            <label className="block text-sm font-medium mb-1">Created</label>
            <p className="text-sm text-[var(--muted-foreground)]">
              {new Date(createdAt).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' })}
            </p>
          </div>
        )}

        {message && (
          <p className={`text-sm ${message.includes('success') ? 'text-green-600' : 'text-[var(--destructive)]'}`}>
            {message}
          </p>
        )}

        {isAdmin && (
          <div className="pt-2">
            <button
              onClick={handleSave}
              disabled={saving || !name.trim()}
              className="px-4 py-2 bg-[var(--brand)] text-white rounded-lg text-sm font-medium hover:opacity-90 disabled:opacity-50 transition-opacity"
            >
              {saving ? 'Saving...' : 'Save Changes'}
            </button>
          </div>
        )}
      </div>

      {/* Features */}
      <div className="bg-[var(--card)] border border-[var(--border)] rounded-lg p-5 space-y-4">
        <h3 className="text-sm font-semibold">Features</h3>

        <FeatureToggle
          label="Knowledge Graph"
          description="Auto-discovers relationships between your connectors' entities (from tool definitions and real usage) and exposes them to agents. Disabling it stops graph building, hides the page, and removes the MCP helper tool."
          checked={!!kg?.enabled}
          disabled={!isAdmin || kgSaving || !kg}
          isAdmin={isAdmin}
          onToggle={() => updateFlag({ enabled: !kg?.enabled })}
        />

        {kg?.llmAvailable && (
          <FeatureToggle
            label="AI enrichment"
            description="Let an LLM suggest extra relationships the heuristics miss (e.g. that a CRM person, a billing customer and a support user are the same person). Only entity and field names are sent — never your data. Suggestions await your confirmation. May incur model costs."
            checked={!!kg?.llmEnabled}
            disabled={!isAdmin || kgSaving || !kg?.enabled}
            isAdmin={isAdmin}
            onToggle={() => updateFlag({ llmEnabled: !kg?.llmEnabled })}
          />
        )}

        <FeatureToggle
          label="Capture user intent"
          description="Adds an optional parameter to every MCP tool asking the agent for the user's original request. Captures the context behind each call so the graph can be optimized and skills suggested over time."
          checked={!!kg?.captureIntent}
          disabled={!isAdmin || kgSaving || !kg?.enabled}
          isAdmin={isAdmin}
          onToggle={() => updateFlag({ captureIntent: !kg?.captureIntent })}
        />

        {kg?.llmAvailable && (
          <FeatureToggle
            label="Scheduled AI extension"
            description="On a schedule (roughly daily), let the AI extend the graph and generate skills from the captured user intents — so your network and skills keep improving on their own. Cost-careful: it only runs every so often, skips when nothing changed, and stays off until you enable it. Requires AI enrichment + Capture user intent."
            checked={!!kg?.autoExtend}
            disabled={!isAdmin || kgSaving || !kg?.enabled || !kg?.llmEnabled}
            isAdmin={isAdmin}
            onToggle={() => updateFlag({ autoExtend: !kg?.autoExtend })}
          />
        )}

        {kg?.llmAvailable && (
          <FeatureToggle
            label="Auto-apply high-confidence skills"
            description="When AI generates a skill it is confident about (≥ 0.90), apply it automatically instead of leaving it as a suggestion to review. Lower-confidence skills still wait for manual approval."
            checked={!!kg?.skillAutoApply}
            disabled={!isAdmin || kgSaving || !kg?.enabled || !kg?.llmEnabled}
            isAdmin={isAdmin}
            onToggle={() => updateFlag({ skillAutoApply: !kg?.skillAutoApply })}
          />
        )}
      </div>

      {/* Danger Zone — ADMIN only */}
      {isAdmin && (
        <div className="border border-[var(--destructive-border)] rounded-lg p-5 bg-[var(--destructive-bg)]/30 space-y-3">
          <h3 className="text-sm font-semibold text-[var(--destructive-text)]">Danger Zone</h3>
          <p className="text-xs text-[var(--muted-foreground)]">
            Permanently delete this organization, including all members, connectors, MCP servers,
            API keys, custom roles, pending invitations, and settings. Other members will be
            migrated to their next-oldest workspace if they have one. This action cannot be undone.
          </p>
          <button
            onClick={() => setDeleteOpen(true)}
            className="border border-[var(--destructive)] text-[var(--destructive)] px-4 py-2 rounded-md text-sm font-medium hover:bg-[var(--destructive-bg)]"
          >
            Delete this organization
          </button>
        </div>
      )}

      <Dialog.Root open={deleteOpen} onOpenChange={(open) => { if (!open) resetDeleteOrgDialog(); }}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 bg-black/50 z-50" />
          <Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-full max-w-md -translate-x-1/2 -translate-y-1/2 rounded-lg border border-[var(--border)] bg-[var(--card)] p-6 shadow-lg">
            <Dialog.Title className="text-lg font-medium mb-2">Delete organization</Dialog.Title>
            <Dialog.Description className="text-sm text-[var(--muted-foreground)] mb-4">
              This deletes <strong>{name}</strong> and everything it contains. To confirm, type the
              organization name below.
            </Dialog.Description>

            <div className="space-y-3">
              <div>
                <label className="block text-sm font-medium mb-1">Type <code>{name}</code> to confirm</label>
                <input
                  type="text"
                  value={deleteConfirmName}
                  onChange={(e) => setDeleteConfirmName(e.target.value)}
                  className="w-full border border-[var(--input)] rounded-md px-3 py-2 text-sm bg-[var(--background)]"
                  autoComplete="off"
                  placeholder={name}
                />
              </div>
              {deleteError && (
                <p className="text-sm text-[var(--destructive)]">{deleteError}</p>
              )}
            </div>

            <div className="flex gap-2 justify-end mt-6">
              <Dialog.Close className="border border-[var(--border)] px-4 py-2 rounded-md text-sm hover:bg-[var(--accent)]">
                Cancel
              </Dialog.Close>
              <button
                onClick={handleDeleteOrg}
                disabled={deleting || deleteConfirmName.trim() !== name.trim()}
                className="bg-[var(--destructive)] text-white px-4 py-2 rounded-md text-sm font-medium hover:opacity-90 disabled:opacity-50"
              >
                {deleting ? 'Deleting…' : 'Delete organization'}
              </button>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>

      {/* My organizations list + create new — available to ALL users */}
      <div className="bg-[var(--card)] border border-[var(--border)] rounded-lg p-5">
        <h3 className="text-sm font-semibold">My Organizations</h3>
        {orgs && orgs.length > 0 && (
          <div className="mt-3">
            {orgs.map((org, index) => {
              const isActive = org.id === user?.organizationId;
              return (
                <div key={org.id}>
                  {index > 0 && (
                    <div className="border-t border-[var(--border)]" />
                  )}
                  <div className={`flex items-center justify-between px-2 rounded-lg ${isActive ? 'bg-[var(--accent)] py-[7px] my-[7px]' : 'py-2.5'}`}>
                    <div className="min-w-0">
                      <p className={`text-sm truncate ${isActive ? 'font-medium' : ''}`}>
                        {org.name}
                      </p>
                      <p className="text-xs text-[var(--muted-foreground)]">
                        {org.role} &middot; Joined {new Date(org.joinedAt).toLocaleDateString()}
                      </p>
                    </div>
                    {isActive ? (
                      <span className="text-xs bg-[var(--brand-light)] text-[var(--brand)] px-2 py-0.5 rounded-full font-medium flex-shrink-0">
                        Active
                      </span>
                    ) : (
                      <button
                        onClick={() => switchOrg(org.id)}
                        className="text-xs px-3 py-1 border border-[var(--border)] rounded-lg hover:bg-[var(--accent)] transition-colors flex-shrink-0"
                      >
                        Switch
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
        <div className="space-y-2 mt-8">
          <p className="text-xs font-medium text-[var(--muted-foreground)]">Create New Organization</p>
          <div className="flex flex-col sm:flex-row gap-2">
            <input
              type="text"
              value={newOrgName}
              onChange={(e) => setNewOrgName(e.target.value)}
              className="flex-1 px-3 py-2 bg-[var(--background)] border border-[var(--border)] rounded-lg text-sm focus:ring-2 focus:ring-[var(--brand)] focus:border-transparent outline-none"
              placeholder="New organization name"
              onKeyDown={(e) => { if (e.key === 'Enter') handleCreateOrg(); }}
            />
            <button
              onClick={handleCreateOrg}
              disabled={creating || !newOrgName.trim()}
              className="px-4 py-2 bg-[var(--brand)] text-white rounded-lg text-sm font-medium hover:opacity-90 disabled:opacity-50 transition-opacity sm:flex-shrink-0"
            >
              {creating ? 'Creating...' : 'Create Organization'}
            </button>
          </div>
          {createMessage && (
            <p className={`text-sm ${createMessage.includes('created') ? 'text-green-600' : 'text-[var(--destructive)]'}`}>
              {createMessage}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

function FeatureToggle({
  label,
  description,
  checked,
  disabled,
  isAdmin,
  onToggle,
}: {
  label: string;
  description: string;
  checked: boolean;
  disabled: boolean;
  isAdmin: boolean;
  onToggle: () => void;
}) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div className="min-w-0">
        <p className="text-sm font-medium">{label}</p>
        <p className="text-xs text-[var(--muted-foreground)] mt-0.5">{description}</p>
      </div>
      <button
        onClick={onToggle}
        disabled={disabled}
        role="switch"
        aria-checked={checked}
        title={isAdmin ? '' : 'Only admins can change this'}
        className={`relative inline-flex h-6 w-11 flex-shrink-0 items-center rounded-full transition-colors disabled:opacity-50 ${
          checked ? 'bg-[var(--brand)]' : 'bg-[var(--border)]'
        }`}
      >
        <span
          className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
            checked ? 'translate-x-6' : 'translate-x-1'
          }`}
        />
      </button>
    </div>
  );
}
