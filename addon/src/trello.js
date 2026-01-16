const API_BASE_URL = "https://api.trello.com/1";
const TRELLO_API_KEY_STORAGE_KEY = "trello_api_key";
const TRELLO_TOKEN_STORAGE_KEY = "trello_token";

const ensureLocalStorageAvailable = () => {
  if (typeof localStorage === "undefined") {
    throw new Error("localStorage is required for Trello credentials");
  }
};

const readTrelloCredentials = () => {
  ensureLocalStorageAvailable();

  const key = localStorage.getItem(TRELLO_API_KEY_STORAGE_KEY);
  const token = localStorage.getItem(TRELLO_TOKEN_STORAGE_KEY);

  if (!key || !token) {
    throw new Error("Missing Trello credentials in localStorage");
  }

  return { key, token };
};

const trelloRequest = async (path, params = {}) => {
  const url = new URL(`${API_BASE_URL}${path}`);
  const search = new URLSearchParams({ ...params, ...readTrelloCredentials() });
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
