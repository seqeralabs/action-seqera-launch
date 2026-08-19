export function workflowWatchUrl(
  apiEndpoint: string,
  orgName: string,
  workspaceName: string,
  workflowId: string,
): string {
  const api = new URL(apiEndpoint);
  const host = api.hostname.replace(/^api\./u, "");
  return `${api.protocol}//${host}/orgs/${encodeURIComponent(orgName)}/workspaces/${encodeURIComponent(workspaceName)}/watch/${encodeURIComponent(workflowId)}`;
}

export function workspaceRef(orgName: string, workspaceName: string): string {
  return `${orgName}/${workspaceName}`;
}
