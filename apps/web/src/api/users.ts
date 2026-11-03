import { apiFetch } from "@/api/client";
import { createUsersApi } from "@/users/usersApi";

export const usersApi = createUsersApi(apiFetch);
