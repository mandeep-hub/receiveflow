// Decides whether a logout really happened. The session cookie is HttpOnly, so
// only the API can end the session: if the request fails, the session is still
// valid and a page reload would log the user back in.
export class LogoutError extends Error {}

const STILL_LOGGED_IN = "You are still logged in.";

export async function requestLogout(send: () => Promise<Response>): Promise<void> {
  let response: Response;

  try {
    response = await send();
  } catch {
    throw new LogoutError(`The server could not be reached. ${STILL_LOGGED_IN} Please try again.`);
  }

  // A 401 means the session has already ended, which is what logging out wants.
  if (response.ok || response.status === 401) {
    return;
  }

  throw new LogoutError(`Logging out failed. ${STILL_LOGGED_IN} Please try again.`);
}
