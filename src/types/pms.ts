import type { BookingStatus, RoomStatus } from "../lib/collections";

export type PaymentMethod = "Cash" | "Mobile Money" | "Card" | "Bank Transfer";
export type PaymentStatus = "Pending" | "Partially Paid" | "Paid" | "Refunded";
export type FolioItemType = "Accommodation" | "Restaurant" | "Conference" | "Laundry" | "Minibar" | "Other";

export interface Reservation {
  id?: string;
  hotelId: string;
  reservationNumber: string;
  guestId?: string;
  guestName: string;
  guestPhoneNumber?: string;
  roomNumber: string;
  roomType: string;
  checkIn: unknown;
  checkOut: unknown;
  numberOfGuests: number;
  status: BookingStatus;
  bookingSource: "Direct" | "Walk-in" | "Phone" | "Website" | "Booking.com" | "Expedia" | "Travel Agent" | "Other";
  ratePerNight: number;
  totalAmount: number;
  depositAmount: number;
  notes?: string;
  createdBy: string;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface FolioItem {
  id?: string;
  hotelId: string;
  reservationId?: string;
  guestId?: string;
  type: FolioItemType;
  description: string;
  quantity: number;
  unitPrice: number;
  amount: number;
  postedAt?: unknown;
  postedBy: string;
  sourceId?: string;
}

export interface Payment {
  id?: string;
  hotelId: string;
  reservationId?: string;
  guestId?: string;
  amount: number;
  method: PaymentMethod;
  reference?: string;
  status: PaymentStatus;
  receivedBy: string;
  receivedAt?: unknown;
  notes?: string;
}

export interface RoomBoardItem {
  room: string;
  type: string;
  status: RoomStatus;
  guestName?: string;
  reservationId?: string;
  checkIn?: unknown;
  checkOut?: unknown;
}

export interface DailyOperationsSnapshot {
  businessDate: string;
  arrivals: number;
  departures: number;
  inHouse: number;
  occupiedRooms: number;
  availableRooms: number;
  roomsCleaning: number;
  roomsMaintenance: number;
  outstandingBalance: number;
  revenue: number;
}
