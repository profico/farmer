/**
 * The Farmer logo, exactly as the owner gave it. The trailing spaces are part
 * of the source and stay here; `logoLines` removes them when the logo is
 * printed, because a terminal shows them as nothing and a narrow one wraps on
 * them.
 */
export const LOGO = `@@@@@@@@@@@@@@@                                                                                     
  @@@@      @@@                                                                                     
  @@@@       @@@                                                                                    
  @@@@       @@@                                                                                    
  @@@@    @@  @    @@@@@@@@       @@@ @@@@@@   @@@  @@@@@@@   @@@@@@         @@@@@@@       @@ @@@@@@
  @@@@   @@@     @@@@  @@@@@   @@@@@@@@@@@@@@@@@@@@@@  @@@@@@@@  @@@@@     @@@@   @@@@ @@@@@@@@@@@@@
  @@@@   @@@    @@@@    @@@@     @@@@@   @@@  @@@@@     @@@@@     @@@@    @@@@     @@@   @@@@@   @@@
  @@@@@@@@@@   @@@@     @@@@     @@@@         @@@@      @@@@      @@@@   @@@@      @@@   @@@@@      
  @@@@   @@@            @@@@     @@@@         @@@@      @@@@      @@@@   @@@@@@@@@@@@@   @@@@@      
  @@@@    @@        @@@@@@@@     @@@@         @@@@      @@@@      @@@@   @@@@            @@@@@      
  @@@@           @@@@   @@@@     @@@@         @@@@      @@@@      @@@@   @@@@            @@@@@      
  @@@@          @@@@    @@@@     @@@@         @@@@      @@@@      @@@@   @@@@       @@   @@@@@      
  @@@@         @@@@    @@@@@ @@  @@@@         @@@@      @@@@      @@@@    @@@@      @@   @@@@@      
  @@@@         @@@@@  @@@@@@@@@  @@@@         @@@@      @@@@      @@@@     @@@@@  @@@@   @@@@@      
@@@@@@@@@@      @@@@@@@  @@@@@ @@@@@@@@@    @@@@@@@@@ @@@@@@@@@ @@@@@@@@@   @@@@@@@@   @@@@@@@@@`;

/** The logo's widest line. A terminal narrower than this wraps every line,
 *  and a wrapped logo is not readable, so the caller shows a title instead. */
export const LOGO_WIDTH = 100;

export const logoLines = (): string[] =>
	LOGO.split("\n").map((line) => line.trimEnd());
