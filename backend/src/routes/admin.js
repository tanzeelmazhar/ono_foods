import { Router } from "express";
import { requireAdmin } from "../middleware/security.js";
import { adminOrdersRouter } from "./admin-orders.js";
import { adminCatalogRouter } from "./admin-catalog.js";
import { adminStoreRouter } from "./admin-store.js";

export const adminRouter = Router();
adminRouter.use(requireAdmin);
adminRouter.use(adminOrdersRouter);
adminRouter.use(adminCatalogRouter);
adminRouter.use(adminStoreRouter);
