declare module 'virtual:product-validator' {
  const validate: (data: unknown) => boolean;
  export default validate;
}
declare module 'virtual:generation-job-validator' {
  const validate: (data: unknown) => boolean;
  export default validate;
}


declare module 'virtual:export-manifest-validator' {
  const validate: (data: unknown) => boolean;
  export default validate;
}

declare const __APP_VERSION__: string;
