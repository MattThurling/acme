// Single source of truth for prices: the finance function looks amounts up
// here by id, so the browser can never submit a tampered amount.
export const PRODUCTS = [
  { id: "cbct-scanner", name: "OrthoVision 3D CBCT Scanner", price: 64500 },
  { id: "cadcam-mill", name: "CeraMill Pro CAD/CAM Milling Unit", price: 48900 },
  { id: "chair-package", name: "ErgoDent Signature Surgery Package", price: 32750 },
  { id: "panoramic-xray", name: "PanoraMax OPG/Ceph X-ray System", price: 27400 },
  { id: "intraoral-scanner", name: "ScanRite IO Intraoral Scanner", price: 18950 },
  { id: "sterilisation-suite", name: "SteriSafe Decontamination Suite", price: 14200 },
];

export const API_BASE = (process.env.MEDIFINANCE_API_URL || "http://localhost:8000")
  .replace(/\/+$/, "");
export const API_KEY = process.env.MEDIFINANCE_API_KEY || "";

export const apiHeaders = () => ({
  Authorization: `Bearer ${API_KEY}`,
  "Content-Type": "application/json",
});
