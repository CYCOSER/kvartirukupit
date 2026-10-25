declare module 'sax' {
  type Tag = { name: string; attributes: Record<string, string> };
  type Parser = {
    onopentag: (tag: Tag) => void;
    onclosetag: (name: string) => void;
    ontext: (text: string) => void;
    oncdata: (text: string) => void;
    ondoctype: () => void;
    onerror: (error: Error) => void;
    write(text: string): Parser;
    close(): Parser;
  };
  const sax: { parser(strict: boolean, options: { strictEntities: boolean }): Parser };
  export default sax;
}
