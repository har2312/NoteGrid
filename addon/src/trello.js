const API_BASE_URL = "https://api.trello.com/1";
const TRELLO_API_KEY_STORAGE_KEY = "trello_api_key";
const TRELLO_TOKEN_STORAGE_KEY = "trello_token";
const TRELLO_LIST_STORAGE_KEY = "trello_default_list_id";

const ensureLocalStorageAvailable = () => {
  if (typeof localStorage === "undefined") {
    throw new Error("localStorage is required for Trello credentials");
  }
};

const getCredentialSnapshot = () => {
  ensureLocalStorageAvailable();
  return {
    key: (localStorage.getItem(TRELLO_API_KEY_STORAGE_KEY) || "").trim(),
    token: (localStorage.getItem(TRELLO_TOKEN_STORAGE_KEY) || "").trim(),
    listId: (localStorage.getItem(TRELLO_LIST_STORAGE_KEY) || "").trim()
  };
};

const readAuthCredentials = () => {
  const { key, token } = getCredentialSnapshot();
  if (!key || !token) {
    throw new Error("Missing Trello credentials in localStorage");
  }
  return { key, token };
};

const trelloRequest = async (path, params = {}) => {
  const url = new URL(`${API_BASE_URL}${path}`);
  const search = new URLSearchParams({ ...params, ...readAuthCredentials() });
  url.search = search.toString();

  const response = await fetch(url.toString(), {
    method: "GET",
    mode: "cors"
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => "");
    throw new Error(`Trello request failed (${response.status}): ${errorText || response.statusText}`);
  }

  return response.json();
};

export const fetchCurrentMember = () =>
  trelloRequest("/members/me", {
    fields: "id,username,fullName,initials,avatarUrl"
  });

export const fetchMemberCards = (extraParams = {}) =>
  trelloRequest("/members/me/cards", {
    fields: "id,name,desc,closed,due,dueComplete,dateLastActivity,idMembers,idMemberCreator",
    filter: "all",
    limit: "500",
    members: "true",
    member_fields: "fullName,initials,username,avatarUrl",
    memberCreator: "true",
    memberCreator_fields: "fullName,initials,username,avatarUrl",
    attachments: "false",
    checklists: "none",
    ...extraParams
  });

export const fetchCardById = (cardId, extraParams = {}) => {
  if (!cardId) {
    throw new Error("Card ID is required");
  }

  return trelloRequest(`/cards/${cardId}`, {
    fields: "id,name,desc,closed,due,dueComplete,dateLastActivity,idMembers,idMemberCreator",
    members: "true",
    member_fields: "fullName,initials,username,avatarUrl",
    ...extraParams
  });
};

const sanitizeCardField = (value, fallback) => {
  const safe = (value || "").toString().trim();
  return safe || fallback;
};

export const createTrelloTask = async (title, description) => {
  const { key, token, listId } = getCredentialSnapshot();
  if (!key || !token || !listId) {
    console.warn("Trello not connected");
    return null;
  }

  const payload = new URLSearchParams({
    idList: listId,
    name: sanitizeCardField(title, "Mention"),
    desc: sanitizeCardField(description, "No additional context provided."),
    key,
    token
  });

  const response = await fetch(`${API_BASE_URL}/cards`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: payload.toString()
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => "");
    throw new Error(`Failed to create Trello card (${response.status}): ${errorText}`);
  }

  return response.json();
};
