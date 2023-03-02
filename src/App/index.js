/* global */
/* exported App */
class App {
  /**
   *
   * @param {App.Settings} settings
   */
  constructor(settings) {
    this.extra = !!settings;
    this._settings = settings;
  }

  get currentBook() {
    if (!this._currentBook) this._currentBook = SpreadsheetApp.openById(this.settings.APP_CURRENT_ID);
    return this._currentBook;
  }

  get folder() {
    if (!this._folder) this._folder = DriveApp.getFolderById(this.settings.APP_FOLDER_ID);
    return this._folder;
  }

  /**
   * @returns {App.Settings}
   */
  get settings() {
    if (!this._settings) {
      this._settings = PropertiesService.getScriptProperties().getProperties();
      this._settings.APP_LIST_OF_EXEPTIONS_SHEETS = JSON.parse(this._settings.APP_LIST_OF_EXEPTIONS_SHEETS);
    }
    return this._settings;
  }

  /**
   * @param {App.Settings} settings
   */
  set settings(settings) {
    if (this.extra) return;
    const data = JSON.parse(JSON.stringify(settings));
    if (this._settings && this._settings.APP_CURRENT_ID !== data.APP_CURRENT_ID) this._book = undefined;
    // console.log(data);
    data.APP_LIST_OF_EXEPTIONS_SHEETS = JSON.stringify(data.APP_LIST_OF_EXEPTIONS_SHEETS || '[]');
    PropertiesService.getScriptProperties().setProperties(data, false);
    this._settings = undefined;
  }

  get book() {
    if (!this._book) this.recallBook();
    return this._book;
  }

  recallBook() {
    this._book = Sheets.Spreadsheets.get(this.settings.APP_CURRENT_ID, {
      includeGridData: false,
      fields: 'spreadsheetId,sheets(properties(sheetId,index,title),protectedRanges(range))',
    });
  }

  /**
   * Сортирует Таблицу заданным образом
   *
   * @returns {GoogleAppsScript.Sheets.Schema.Spreadsheet}
   */
  orderSheetsByProtections() {
    const exeptionSheetNames = this.settings.APP_LIST_OF_EXEPTIONS_SHEETS;
    const sorted = JSON.parse(JSON.stringify(this.book.sheets)).sort((a, b) => {
      const excludesA = exeptionSheetNames.indexOf(a.properties.title);
      const excludesB = exeptionSheetNames.indexOf(b.properties.title);
      if (excludesA > -1 && excludesB > -1) return excludesA - excludesB;
      if (excludesA > -1) return -1;
      if (excludesB > -1) return 1;
      const protectedA = a.protectedRanges?.some((r) => Object.keys(r.range).length === 1) ?? false;
      const protectedB = b.protectedRanges?.some((r) => Object.keys(r.range).length === 1) ?? false;
      return protectedA - protectedB;
    });
    const requests = [];
    requests.push(
      ...sorted.map((sheet, index) => {
        const updatePropertiesRequest = Sheets.newUpdateSheetPropertiesRequest();
        updatePropertiesRequest.fields = 'index';
        updatePropertiesRequest.properties = {
          index,
          sheetId: sheet.properties.sheetId,
        };
        const request = Sheets.newRequest();
        request.updateSheetProperties = updatePropertiesRequest;
        return request;
      }),
    );
    const resource = Sheets.newBatchUpdateSpreadsheetRequest();
    resource.requests = requests;
    resource.responseIncludeGridData = false;
    Sheets.Spreadsheets.batchUpdate(resource, this.settings.APP_CURRENT_ID);
    this.book.sheets = sorted;
  }

  addNewBlankUserSheet() {
    if (!this.book.sheets.some((sheet) => sheet.properties.title === 'Новый лист для вашего примера')) {
      const addSheetRequest = Sheets.newAddSheetRequest();
      addSheetRequest.properties = {
        index: 1,
        title: 'Новый лист для вашего примера',
      };
      const request = Sheets.newRequest();
      request.addSheet = addSheetRequest;
      const resource = Sheets.newBatchUpdateSpreadsheetRequest();
      resource.requests = [request];
      resource.includeSpreadsheetInResponse = true;
      resource.responseIncludeGridData = false;
      const reply = Sheets.Spreadsheets.batchUpdate(resource, this.settings.APP_CURRENT_ID).replies.find(
        (reply) => reply.addSheet,
      ).addSheet;
      this._book.sheets.splice(1, 0, {
        properties: reply.properties,
      });
      this._book.sheets.forEach((sheet, i) => (sheet.properties.index = i));

      console.log(JSON.stringify(this.book, null, '  '));
    }
  }

  /**
   *
   */
  generateTOC() {
    const excludeSheetNames = this.settings.APP_LIST_OF_EXEPTIONS_SHEETS;

    const richTextValues = this.book.sheets
      .filter((item) => excludeSheetNames.indexOf(item.properties.title) === -1)
      .map((item) => [
        SpreadsheetApp.newRichTextValue()
          .setText(
            `${item.protectedRanges?.some((r) => Object.keys(r.range).length === 1) ?? false ? '🔏 ' : ''}${
              item.properties.title
            }`,
          )
          .setLinkUrl(`#gid=${item.properties.sheetId}`)
          .build(),
      ]);
    const firstPage = this.currentBook.getSheetByName('О Таблице');
    const pos = firstPage.createTextFinder('Содержание').matchCase(true).matchFormulaText(false).findNext();
    if (pos) {
      const range = firstPage.getRange(pos.getRow() + 1, pos.getColumn(), firstPage.getLastRow()).clearContent();
      range.offset(0, 0, richTextValues.length, richTextValues[0].length).setRichTextValues(richTextValues);
    }
  }

  cleanBook() {
    const requests = this.book.sheets
      .filter((sheet) => !this.settings.APP_LIST_OF_EXEPTIONS_SHEETS.includes(sheet.properties.title))
      .map((sheet) => {
        const deleteSheetRequest = Sheets.newDeleteSheetRequest();
        deleteSheetRequest.sheetId = sheet.properties.sheetId;
        const request = Sheets.newRequest();
        request.deleteSheet = deleteSheetRequest;
        return request;
      });
    if (requests.length) {
      Sheets.Spreadsheets.batchUpdate({ requests }, this.book.spreadsheetId);
      this._book = undefined;
    }
  }

  updateStamp({ num, prevUrl, prevTitle }) {
    if (this.book.sheets.some((sheet) => sheet.properties.title === 'О Таблице'))
      Sheets.Spreadsheets.Values.update(
        { values: [[num], [prevUrl, prevTitle]] },
        this.book.spreadsheetId,
        'О Таблице',
        {
          valueInputOption: 'RAW',
        },
      );
  }
}
