export type ApiRequest = {
  /** Used in the URL path; excluded from the HTTP body. */
  deviceId: string;
  data: {
    /** Unix timestamp in seconds. */
    startTime: number;
    /** Unix timestamp in seconds. */
    endTime: number;
    /** Integer watts: positive charges, negative discharges. */
    value: number;
  };
};
